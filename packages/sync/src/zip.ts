/**
 * 최소 ZIP 쓰기·읽기. `.quire` 컨테이너(07 §2)용. 의존성 없이 브라우저·Worker·Node에서 돈다.
 * 압축은 deflate(8)와 stored(0)만. deflate는 표준 CompressionStream('deflate-raw')을 쓴다.
 * 시각은 1980-01-01로 고정한다 (같은 내용 = 같은 바이트열).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** 압축 (기본: 아니오) */
  deflate?: boolean;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** 항목 순서대로 쓴다 (`.quire`는 압축하지 않은 mimetype이 첫 항목이어야 한다) */
export async function writeZip(entries: ZipEntry[]): Promise<Uint8Array<ArrayBuffer>> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = encoder.encode(e.name);
    const crc = crc32(e.data);
    let body = e.data;
    let method = 0;
    if (e.deflate) {
      const z = await pipe(e.data, new CompressionStream('deflate-raw'));
      if (z.length < e.data.length) {
        body = z;
        method = 8;
      }
    }
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // 필요한 버전
    lv.setUint16(6, 0x0800, true); // 이름이 UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true); // 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export interface ReadEntry {
  name: string;
  data: Uint8Array;
  /** 0 = stored, 8 = deflate */
  method: number;
}

/** 항목을 저장 순서대로 읽는다 */
export async function readZip(bytes: Uint8Array): Promise<ReadEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 끝 레코드 찾기 (뒤에 주석이 붙을 수 있다)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: Array<ReadEntry & { offset: number }> = [];
  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const csize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0 && method !== 8) throw new Error(`zip: ${name} uses an unsupported compression method (${method})`);
    if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const body = bytes.slice(start, start + csize);
    let data: Uint8Array;
    try {
      data = method === 8 ? await pipe(body, new DecompressionStream('deflate-raw')) : body;
    } catch {
      throw new Error(`zip: ${name} is damaged (inflate)`);
    }
    if (data.length !== size || crc32(data) !== crc) throw new Error(`zip: ${name} is damaged (crc)`);
    out.push({ name, data, method, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  out.sort((a, b) => a.offset - b.offset);
  return out.map(({ name, data, method }) => ({ name, data, method }));
}
