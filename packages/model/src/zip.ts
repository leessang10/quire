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

/** 읽기 상한 (16 §6): 압축 폭탄·망가진 파일에서 메모리를 다 쓰지 않게 */
export interface ZipLimits {
  /** 항목 수 (기본 20,000) */
  maxEntries?: number;
  /** 풀린 항목 하나의 바이트 (기본 256 MiB) */
  maxEntryBytes?: number;
  /** 풀린 모든 항목의 바이트 (기본 512 MiB) */
  maxTotalBytes?: number;
}

export const ZIP_LIMITS: Required<ZipLimits> = { maxEntries: 20_000, maxEntryBytes: 256 * 2 ** 20, maxTotalBytes: 512 * 2 ** 20 };

/** deflate를 풀되 limit 바이트를 넘으면 멈추고 null (끝까지 풀지 않는다) */
async function inflateAtMost(body: Uint8Array, limit: number): Promise<Uint8Array | null> {
  const reader = new Blob([body as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 항목을 저장 순서대로 읽는다. 망가졌거나 상한을 넘으면 설명 있는 오류 ("zip: …") */
export async function readZip(bytes: Uint8Array, limits: ZipLimits = {}): Promise<ReadEntry[]> {
  const lim = { ...ZIP_LIMITS, ...limits };
  try {
    return await readZipUnchecked(bytes, lim);
  } catch (e) {
    // 범위 밖 읽기(DataView RangeError) 같은 것도 망가진 파일로 알린다
    if (e instanceof Error && e.message.startsWith('zip:')) throw e;
    throw new Error(`zip: damaged file (${e instanceof Error ? e.message : String(e)})`);
  }
}

async function readZipUnchecked(bytes: Uint8Array, lim: Required<ZipLimits>): Promise<ReadEntry[]> {
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
  if (count > lim.maxEntries) throw new Error(`zip: too many entries (${count} > ${lim.maxEntries})`);
  let p = view.getUint32(eocd + 16, true);
  let total = 0;
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
    if (size > lim.maxEntryBytes) throw new Error(`zip: ${name} is too large (${size} bytes > ${lim.maxEntryBytes})`);
    if (total + size > lim.maxTotalBytes) throw new Error(`zip: contents too large (> ${lim.maxTotalBytes} bytes)`);
    if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (start + csize > bytes.length) throw new Error(`zip: ${name} is truncated`);
    const body = bytes.slice(start, start + csize);
    let data: Uint8Array | null;
    try {
      // 선언한 크기까지만 푼다: 그보다 크게 풀리면(압축 폭탄, 거짓 크기) 멈춘다
      data = method === 8 ? await inflateAtMost(body, size) : body;
    } catch {
      throw new Error(`zip: ${name} is damaged (inflate)`);
    }
    if (data === null || data.length !== size || crc32(data) !== crc) throw new Error(`zip: ${name} is damaged (crc)`);
    total += size;
    out.push({ name, data, method, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  out.sort((a, b) => a.offset - b.offset);
  return out.map(({ name, data, method }) => ({ name, data, method }));
}
