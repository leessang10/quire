/**
 * PDF 글꼴 (15 §5.2): 글꼴 자리·굵기마다 한 얼굴. 그리기 대상이 글자 조각을 HarfBuzz로 셰이핑해 글리프를 받고, 쓴 글리프를
 * 모은다. 다 그린 뒤 쓴 글리프만 남겨(부분화, 글리프 ID 유지) Type0 글꼴(Identity-H)로 넣는다: CFF면 CIDFontType0 +
 * FontFile3/OpenType, TrueType이면 CIDFontType2 + FontFile2. 글자 복사·검색을 위해 ToUnicode CMap을 단다.
 */
import * as hb from 'harfbuzzjs';
import { loadShapingFont, type ShapingFont } from '@quire/shaping';
import { capHeight, cffCids, headInfo, isCff, sfntTables } from './sfnt';
import type { Subsetter } from './subset';
import { name, type PdfWriter, type Ref } from './writer';

/** 글꼴 파일 하나 */
export interface PdfFontFile {
  bytes: Uint8Array;
  name: string;
}

/** 편집기의 글꼴: 자리 slot의 얼굴 (bold면 굵은 얼굴. 없으면 null → 보통 굵기를 합성 굵게) */
export interface PdfFontSource {
  readonly count: number;
  face(slot: number, bold: boolean): PdfFontFile | null;
}

/** 셰이핑한 글리프 하나 */
export interface PdfGlyph {
  g: number;
  /** 조각 안 UTF-16 클러스터 */
  cl: number;
  /** 진행폭·x 이동 (글꼴 단위) */
  ax: number;
  dx: number;
}

export class PdfFace {
  readonly font: ShapingFont;
  readonly upem: number;
  /** 쓴 글리프 → 글자 (ToUnicode) */
  readonly used = new Map<number, string>();
  /** 자원 이름 (/F1) */
  readonly res: string;
  ref: Ref | null = null;
  /** 글리프 → CID (부분화 뒤 정한다) */
  cid: (g: number) => number = (g) => g;

  constructor(
    readonly file: PdfFontFile,
    index: number,
  ) {
    this.font = loadShapingFont(file.bytes, file.name);
    this.upem = this.font.upem;
    this.res = `F${index + 1}`;
  }

  /** 글리프 진행폭 (1000/em, PDF W 배열과 같은 반올림) */
  width(g: number): number {
    return Math.round((this.font.hb.glyphHAdvance(g) * 1000) / this.upem);
  }

  has(cp: number): boolean {
    return this.font.has(cp);
  }
}

const buffer = new hb.Buffer();

/** 글자를 셰이핑한다 (커닝·합자 켬, 옛 kern 표 적용: 레이아웃 셰이퍼와 같게) */
export function shapeText(face: PdfFace, text: string): PdfGlyph[] {
  buffer.reset();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(face.font.hb, buffer);
  const out = buffer.getGlyphInfosAndPositions().map((g) => ({ g: g.codepoint, cl: g.cluster, ax: g.xAdvance ?? 0, dx: g.xOffset ?? 0 }));
  const kern = face.font.legacyKern;
  if (kern) for (let i = 0; i + 1 < out.length; i++) out[i]!.ax += kern.get(out[i]!.g * 65536 + out[i + 1]!.g) ?? 0;
  return out;
}

/** 글꼴 등록부: 자리·굵기 → 얼굴 (불러온 것만) */
export class PdfFonts {
  private readonly faces = new Map<string, PdfFace | null>();
  private readonly list: PdfFace[] = [];

  constructor(private readonly source: PdfFontSource) {}

  /** 자리 slot의 얼굴과 합성 굵게 여부. slot이 -1(시스템 글꼴)이면 글자 cp를 가진 첫 얼굴 */
  pick(slot: number, bold: boolean, cp: number): { face: PdfFace; synthetic: boolean } | null {
    if (slot >= 0) {
      if (bold) {
        const b = this.get(slot, true);
        if (b) return { face: b, synthetic: false };
      }
      const r = this.get(slot, false);
      return r ? { face: r, synthetic: bold } : null;
    }
    for (let s = 0; s < this.source.count; s++) {
      const r = this.get(s, false);
      if (r?.has(cp)) return this.pick(s, bold, cp);
    }
    return null;
  }

  private get(slot: number, bold: boolean): PdfFace | null {
    const key = `${slot}:${bold ? 1 : 0}`;
    let f = this.faces.get(key);
    if (f === undefined) {
      const file = this.source.face(slot, bold);
      f = file ? new PdfFace(file, this.list.length) : null;
      if (f) this.list.push(f);
      this.faces.set(key, f);
    }
    return f;
  }

  /** 쓴 얼굴 */
  get used(): readonly PdfFace[] {
    return this.list.filter((f) => f.used.size > 0);
  }

  /** 쓴 얼굴을 부분화해 넣는다 (글리프 → CID를 정한다) */
  async write(w: PdfWriter, subsetter: Subsetter | null): Promise<void> {
    for (const face of this.used) await writeFace(w, face, subsetter);
  }
}

/** PostScript 이름: ASCII 글자·숫자만 */
function psName(s: string, fallback: string): string {
  const v = s.replace(/[^A-Za-z0-9-]/g, '');
  return v || fallback;
}

/** 부분 글꼴 꼬리표 (글리프 목록에서 정한 대문자 여섯) */
function subsetTag(glyphs: number[]): string {
  let h = 0x811c9dc5;
  for (const g of glyphs) {
    h ^= g;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let t = '';
  for (let i = 0; i < 6; i++) {
    t += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) + i * 7;
  }
  return t;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');

function utf16Hex(s: string): string {
  let h = '';
  for (let i = 0; i < s.length; i++) h += hex4(s.charCodeAt(i));
  return h;
}

async function writeFace(w: PdfWriter, face: PdfFace, subsetter: Subsetter | null): Promise<void> {
  const glyphs = [...face.used.keys()].sort((a, b) => a - b);
  const bytes = subsetter?.subset(face.file.bytes, glyphs) ?? face.file.bytes;
  const tables = sfntTables(bytes);
  const cff = isCff(tables);
  const cids = cff ? cffCids(tables) : null;
  face.cid = cids ? (g) => cids[g] ?? 0 : (g) => g;
  const { upem, bbox } = headInfo(tables);
  const s = (v: number) => Math.round((v * 1000) / upem);
  const base = `${subsetTag(glyphs)}+${psName(face.file.name, face.res)}`;
  const m = face.font.metrics;
  const cap = capHeight(tables);

  const fileRef = cff ? await w.stream({ Subtype: name('OpenType') }, bytes) : await w.stream({ Length1: bytes.length }, bytes);
  const descriptor = w.write({
    Type: name('FontDescriptor'),
    FontName: name(base),
    Flags: 4,
    FontBBox: bbox.map(s),
    ItalicAngle: 0,
    Ascent: Math.round(m.ascent * 1000),
    Descent: Math.round(-m.descent * 1000),
    CapHeight: cap !== null ? s(cap) : Math.round(m.ascent * 700),
    StemV: 80,
    [cff ? 'FontFile3' : 'FontFile2']: fileRef,
  });

  // W: CID 순으로, 이어진 CID는 한 묶음
  const byCid = glyphs.map((g) => [face.cid(g), face.width(g)] as const).sort((a, b) => a[0] - b[0]);
  const W: Array<number | number[]> = [];
  for (let i = 0; i < byCid.length; ) {
    const start = byCid[i]![0];
    const ws: number[] = [];
    let j = i;
    while (j < byCid.length && byCid[j]![0] === start + (j - i)) ws.push(byCid[j++]![1]);
    W.push(start, ws);
    i = j;
  }
  const cid = w.write({
    Type: name('Font'),
    Subtype: name(cff ? 'CIDFontType0' : 'CIDFontType2'),
    BaseFont: name(base),
    CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
    FontDescriptor: descriptor,
    DW: 1000,
    W,
    ...(cff ? {} : { CIDToGIDMap: name('Identity') }),
  });

  // ToUnicode: CID → 글자 (100개씩)
  const pairs = glyphs.filter((g) => face.used.get(g)).map((g) => `<${hex4(face.cid(g))}> <${utf16Hex(face.used.get(g)!)}>`);
  let body = '';
  for (let i = 0; i < pairs.length; i += 100) {
    const part = pairs.slice(i, i + 100);
    body += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`;
  }
  const cmap =
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    `1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
  const toUnicode = await w.stream({}, new TextEncoder().encode(cmap));

  face.ref = w.write({
    Type: name('Font'),
    Subtype: name('Type0'),
    BaseFont: name(base),
    Encoding: name('Identity-H'),
    DescendantFonts: [cid],
    ToUnicode: toUnicode,
  });
}
