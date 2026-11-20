/**
 * 글꼴 부분화 (15 §5.2, O-37): harfbuzzjs에 든 hb-subset WASM으로 쓴 글리프만 남긴다. 글리프 ID를 그대로 둔다
 * (RETAIN_GIDS: 쓰지 않는 글리프는 빈 글리프) → PDF는 셰이핑한 글리프 ID를 그대로 CID로 쓴다 (Identity-H).
 * 레이아웃 표(GSUB·GPOS·GDEF·kern)는 PDF가 쓰지 않으므로 뺀다.
 */

interface SubsetExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_length(b: number): number;
  hb_blob_get_data(b: number, lenOut: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_glyph_set(i: number): number;
  hb_subset_input_set(i: number, which: number): number;
  hb_subset_input_set_flags(i: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
  hb_set_add(set: number, v: number): void;
}

/** hb_subset_flags_t */
const RETAIN_GIDS = 0x2;
const NO_HINTING = 0x1;
/** hb_subset_sets_t */
const DROP_TABLE_TAG = 3;
const DROPPED = ['GSUB', 'GPOS', 'GDEF', 'kern', 'BASE', 'JSTF', 'MATH', 'vhea', 'vmtx', 'VORG', 'DSIG'];

const tag = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;

export interface Subsetter {
  /** 글리프 ID 목록만 남긴 글꼴 파일 (글리프 ID 유지). 실패하면 null */
  subset(font: Uint8Array, glyphs: Iterable<number>): Uint8Array | null;
}

/** hb-subset WASM(harfbuzzjs/dist/harfbuzz-subset.wasm 바이트)으로 부분화기를 만든다 */
export async function loadSubsetter(wasm: BufferSource | WebAssembly.Module): Promise<Subsetter> {
  const instance = wasm instanceof WebAssembly.Module ? await WebAssembly.instantiate(wasm, {}) : (await WebAssembly.instantiate(wasm, {})).instance;
  const x = instance.exports as unknown as SubsetExports;
  x._initialize?.();
  return {
    subset(font, glyphs) {
      const ptr = x.malloc(font.length);
      new Uint8Array(x.memory.buffer, ptr, font.length).set(font);
      // HB_MEMORY_MODE_WRITABLE(2): 우리가 malloc한 메모리, 해제는 우리가
      const blob = x.hb_blob_create(ptr, font.length, 2, 0, 0);
      const face = x.hb_face_create(blob, 0);
      x.hb_blob_destroy(blob);
      const input = x.hb_subset_input_create_or_fail();
      let out: Uint8Array | null = null;
      try {
        if (!input) return null;
        const set = x.hb_subset_input_glyph_set(input);
        x.hb_set_add(set, 0);
        for (const g of glyphs) x.hb_set_add(set, g);
        const drop = x.hb_subset_input_set(input, DROP_TABLE_TAG);
        for (const t of DROPPED) x.hb_set_add(drop, tag(t));
        x.hb_subset_input_set_flags(input, RETAIN_GIDS | NO_HINTING);
        const res = x.hb_subset_or_fail(face, input);
        if (!res) return null;
        const rb = x.hb_face_reference_blob(res);
        const len = x.hb_blob_get_length(rb);
        const data = x.hb_blob_get_data(rb, 0);
        out = len > 0 ? new Uint8Array(x.memory.buffer, data, len).slice() : null;
        x.hb_blob_destroy(rb);
        x.hb_face_destroy(res);
      } finally {
        if (input) x.hb_subset_input_destroy(input);
        x.hb_face_destroy(face);
        x.free(ptr);
      }
      return out;
    },
  };
}
