/**
 * PDF 이미지 (15 §5.2): JPEG는 그대로 (DCTDecode), PNG는 IDAT를 그대로 넣고 PNG 예측자로 풀게 한다 (FlateDecode +
 * Predictor 15). 알파가 있거나(색 유형 4·6, tRNS) 비월이면 픽셀을 풀어 색과 알파(SMask)로 나눈다.
 */
import { name, raw, type PdfValue, type PdfWriter, type Ref } from './writer';

export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

export interface ImageInfo {
  width: number;
  height: number;
}

const be32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;

export function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

export function isPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

/** JPEG 크기와 색 성분 수 (SOFn 표지) */
export function jpegInfo(b: Uint8Array): (ImageInfo & { components: number }) | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1]!;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = be16(b, i + 2);
    // SOF0–SOF15 (DHT c4, JPG c8, DAC cc 제외)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: be16(b, i + 5), width: be16(b, i + 7), components: b[i + 9]! };
    }
    i += 2 + len;
  }
  return null;
}

interface PngChunks {
  width: number;
  height: number;
  depth: number;
  type: number;
  interlace: number;
  plte: Uint8Array | null;
  trns: Uint8Array | null;
  idat: Uint8Array;
}

function pngChunks(b: Uint8Array): PngChunks | null {
  let i = 8;
  let ihdr: Uint8Array | null = null;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (i + 8 <= b.length) {
    const len = be32(b, i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const data = b.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (!ihdr || !idat.length) return null;
  const all = new Uint8Array(idat.reduce((a, c) => a + c.length, 0));
  let at = 0;
  for (const c of idat) {
    all.set(c, at);
    at += c.length;
  }
  return { width: be32(ihdr, 0), height: be32(ihdr, 4), depth: ihdr[8]!, type: ihdr[9]!, interlace: ihdr[12]!, plte, trns, idat: all };
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** PNG 줄 필터 풀기 (8비트 이상, 비월 아님) */
function unfilter(data: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const f = data[src++]!;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = data[src++]!;
      const a = x >= bpp ? out[row + x - bpp]! : 0;
      const b = y > 0 ? out[prev + x]! : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp]! : 0;
      let r: number;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[row + x] = r & 0xff;
    }
  }
  return out;
}

/**
 * 이미지를 XObject로 쓴다. 다루지 못하는 형식(비월 PNG, 16비트 알파 등)이면 null
 */
export async function writeImage(w: PdfWriter, bytes: Uint8Array, inflate: Inflate): Promise<(ImageInfo & { ref: Ref }) | null> {
  if (isJpeg(bytes)) {
    const info = jpegInfo(bytes);
    if (!info) return null;
    const cs = info.components === 1 ? 'DeviceGray' : info.components === 4 ? 'DeviceCMYK' : 'DeviceRGB';
    const dict: Record<string, PdfValue> = { Type: name('XObject'), Subtype: name('Image'), Width: info.width, Height: info.height, ColorSpace: name(cs), BitsPerComponent: 8, Filter: name('DCTDecode') };
    // Adobe CMYK JPEG는 흔히 뒤집혀 있다
    if (info.components === 4) dict.Decode = [1, 0, 1, 0, 1, 0, 1, 0];
    const ref = await w.stream(dict, bytes, false);
    return { width: info.width, height: info.height, ref };
  }
  if (!isPng(bytes)) return null;
  const p = pngChunks(bytes);
  if (!p) return null;
  const ch = CHANNELS[p.type];
  if (!ch || p.interlace !== 0) return null;
  const alpha = p.type === 4 || p.type === 6;
  const colorSpace = (): PdfValue => {
    if (p.type === 3 && p.plte) {
      const hex = Array.from(p.plte, (b) => b.toString(16).padStart(2, '0')).join('');
      return [name('Indexed'), name('DeviceRGB'), p.plte.length / 3 - 1, raw(`<${hex}>`)];
    }
    return name(p.type === 0 || p.type === 4 ? 'DeviceGray' : 'DeviceRGB');
  };
  if (!alpha) {
    // 예측자로 PDF가 푼다 (IDAT 그대로)
    const dict: Record<string, PdfValue> = {
      Type: name('XObject'), Subtype: name('Image'), Width: p.width, Height: p.height, ColorSpace: colorSpace(), BitsPerComponent: p.depth,
      Filter: name('FlateDecode'), DecodeParms: { Predictor: 15, Colors: ch, BitsPerComponent: p.depth, Columns: p.width },
    };
    // 팔레트 tRNS: 완전히 투명한 색인 하나면 색 키 가리기
    if (p.type === 3 && p.trns) {
      const k = Array.from(p.trns).findIndex((a) => a === 0);
      if (k >= 0 && Array.from(p.trns).every((a, i) => i === k || a === 255)) dict.Mask = [k, k];
    }
    const ref = await w.stream(dict, p.idat, false);
    return { width: p.width, height: p.height, ref };
  }
  if (p.depth !== 8) return null;
  const pixels = unfilter(await inflate(p.idat), p.width, p.height, ch);
  const n = p.width * p.height;
  const color = new Uint8Array(n * (ch - 1));
  const a = new Uint8Array(n);
  for (let i = 0, ci = 0; i < n; i++) {
    for (let k = 0; k < ch - 1; k++) color[ci++] = pixels[i * ch + k]!;
    a[i] = pixels[i * ch + ch - 1]!;
  }
  const smask = await w.stream({ Type: name('XObject'), Subtype: name('Image'), Width: p.width, Height: p.height, ColorSpace: name('DeviceGray'), BitsPerComponent: 8 }, a);
  const ref = await w.stream(
    { Type: name('XObject'), Subtype: name('Image'), Width: p.width, Height: p.height, ColorSpace: colorSpace(), BitsPerComponent: 8, SMask: smask },
    color,
  );
  return { width: p.width, height: p.height, ref };
}
