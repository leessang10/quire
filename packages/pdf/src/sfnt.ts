/**
 * OpenType 파일에서 PDF가 필요한 것만 읽는다: 표 위치, head의 글꼴 상자, CFF의 CID 여부와 글리프 → CID (charset).
 * PDF의 CIDFontType0(CFF)은 내용 스트림의 코드(Identity-H면 CID)로 글리프를 찾는다. CFF가 CID 방식(ROS 연산자)이면
 * charset으로 CID → 글리프를 찾으므로 글리프 ID가 아니라 CID를 써야 한다 (Noto Sans KR). 아니면 CID = 글리프 ID.
 */

export interface SfntTables {
  get(tag: string): Uint8Array | null;
}

export function sfntTables(b: Uint8Array): SfntTables {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const map = new Map<string, Uint8Array>();
  if (b.length >= 12) {
    const n = v.getUint16(4);
    for (let i = 0; i < n; i++) {
      const at = 12 + i * 16;
      if (at + 16 > b.length) break;
      const tag = String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
      const off = v.getUint32(at + 8);
      const len = v.getUint32(at + 12);
      if (off + len <= b.length) map.set(tag, b.subarray(off, off + len));
    }
  }
  return { get: (tag) => map.get(tag) ?? null };
}

/** head 표: unitsPerEm, 글꼴 상자 [xMin, yMin, xMax, yMax] */
export function headInfo(t: SfntTables): { upem: number; bbox: [number, number, number, number] } {
  const h = t.get('head');
  if (!h || h.length < 44) return { upem: 1000, bbox: [0, -200, 1000, 800] };
  const v = new DataView(h.buffer, h.byteOffset, h.byteLength);
  return { upem: v.getUint16(18), bbox: [v.getInt16(36), v.getInt16(38), v.getInt16(40), v.getInt16(42)] };
}

/** OS/2의 대문자 높이 (없으면 null) */
export function capHeight(t: SfntTables): number | null {
  const o = t.get('OS/2');
  if (!o || o.length < 90) return null;
  const v = new DataView(o.buffer, o.byteOffset, o.byteLength);
  return v.getUint16(0) >= 2 ? v.getInt16(88) : null;
}

interface Index {
  /** 각 항목의 [시작, 끝) (CFF 안 위치) */
  items: Array<[number, number]>;
  end: number;
}

function readIndex(c: Uint8Array, at: number): Index {
  const count = (c[at]! << 8) | c[at + 1]!;
  if (count === 0) return { items: [], end: at + 2 };
  const offSize = c[at + 2]!;
  const off = (i: number) => {
    let x = 0;
    for (let k = 0; k < offSize; k++) x = x * 256 + c[at + 3 + i * offSize + k]!;
    return x;
  };
  const base = at + 3 + (count + 1) * offSize - 1;
  const items: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) items.push([base + off(i), base + off(i + 1)]);
  return { items, end: base + off(count) };
}

/** DICT를 연산자 → 피연산자로 (12 x는 1200 + x) */
function readDict(c: Uint8Array, from: number, to: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  let ops: number[] = [];
  let i = from;
  while (i < to) {
    const b0 = c[i]!;
    if (b0 <= 21) {
      let op = b0;
      i++;
      if (b0 === 12) op = 1200 + c[i++]!;
      out.set(op, ops);
      ops = [];
    } else if (b0 === 28) {
      ops.push(((c[i + 1]! << 24) >> 16) | c[i + 2]!);
      i += 3;
    } else if (b0 === 29) {
      ops.push((c[i + 1]! << 24) | (c[i + 2]! << 16) | (c[i + 3]! << 8) | c[i + 4]!);
      i += 5;
    } else if (b0 === 30) {
      // 실수: 니블을 건너뛴다 (값은 쓰지 않는다)
      i++;
      while (i < to) {
        const b = c[i++]!;
        if ((b & 0x0f) === 0x0f || (b >> 4) === 0x0f) break;
      }
      ops.push(0);
    } else if (b0 >= 32 && b0 <= 246) {
      ops.push(b0 - 139);
      i++;
    } else if (b0 >= 247 && b0 <= 250) {
      ops.push((b0 - 247) * 256 + c[i + 1]! + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      ops.push(-(b0 - 251) * 256 - c[i + 1]! - 108);
      i += 2;
    } else i++;
  }
  return out;
}

/**
 * CFF 글꼴의 글리프 → CID. CID 방식이 아니거나 CFF가 아니면 null (CID = 글리프 ID)
 */
export function cffCids(t: SfntTables): Uint32Array | null {
  const c = t.get('CFF ');
  if (!c || c.length < 4) return null;
  const nameIdx = readIndex(c, c[2]!);
  const topIdx = readIndex(c, nameIdx.end);
  const top = topIdx.items[0];
  if (!top) return null;
  const dict = readDict(c, top[0], top[1]);
  if (!dict.has(1230)) return null; // ROS 없음
  const csAt = dict.get(17)?.[0];
  const charsetAt = dict.get(15)?.[0];
  if (csAt === undefined || charsetAt === undefined) return null;
  const n = readIndex(c, csAt).items.length;
  const cids = new Uint32Array(n);
  let at = charsetAt;
  const fmt = c[at++]!;
  let gid = 1;
  const u16 = (i: number) => (c[i]! << 8) | c[i + 1]!;
  if (fmt === 0) {
    for (; gid < n; gid++, at += 2) cids[gid] = u16(at);
  } else if (fmt === 1 || fmt === 2) {
    while (gid < n && at < c.length) {
      const first = u16(at);
      const left = fmt === 1 ? c[at + 2]! : u16(at + 2);
      at += fmt === 1 ? 3 : 4;
      for (let k = 0; k <= left && gid < n; k++) cids[gid++] = first + k;
    }
  } else return null;
  return cids;
}

export function isCff(t: SfntTables): boolean {
  return t.get('CFF ') !== null;
}
