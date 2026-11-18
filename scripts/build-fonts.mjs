// 엔진 글꼴을 유니코드 범위별 조각으로 자른다 (02 §4 부분 로드, ADR-0002)
//   node scripts/build-fonts.mjs [출력 디렉터리]     기본: apps/playground/public/fonts
//
// 입력: fonts/<글꼴>/*.otf (OFL, 저장소에 있음). 출력: <출력>/<id>/<조각>.otf + <출력>/<id>/manifest.json
// 조각은 HarfBuzz 부분 집합(hb-subset, harfbuzzjs의 harfbuzz-subset.wasm)이며 레이아웃 기능을 모두 남긴다
// (커닝·합자·옛한글 조합). 엔진은 문서에 나온 글자가 든 조각만 내려받는다.
//
// manifest.json: { id, name, file(원본), chunks: [{ name, file, bytes, count, cover }] }
//   cover: 가진 글자 범위를 줄인 문자열. 범위마다 "앞 범위 끝에서 띈 거리(36진)" + 길이가 2 이상이면 "." + (길이-1)(36진),
//   쉼표로 잇는다 (packages/shaping/src/manifest.ts decodeCover)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hb from 'harfbuzzjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = process.argv[2] ?? join(root, 'apps/playground/public/fonts');

// ── hb-subset (standalone WASM) ──
const wasm = await WebAssembly.instantiate(readFileSync(join(root, 'node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm')));
const ex = wasm.instance.exports;
const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;

function subset(fontBytes, codepoints) {
  const ptr = ex.malloc(fontBytes.length);
  new Uint8Array(ex.memory.buffer).set(fontBytes, ptr);
  const blob = ex.hb_blob_create(ptr, fontBytes.length, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = ex.hb_face_create(blob, 0);
  ex.hb_blob_destroy(blob);
  const input = ex.hb_subset_input_create_or_fail();
  if (!input) throw new Error('hb_subset_input_create_or_fail');
  const uset = ex.hb_subset_input_unicode_set(input);
  for (const cp of codepoints) ex.hb_set_add(uset, cp);
  // 레이아웃 기능을 모두 남긴다 (기본은 일부만)
  const feats = ex.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
  ex.hb_set_clear(feats);
  ex.hb_set_invert(feats);
  const sub = ex.hb_subset_or_fail(face, input);
  ex.hb_subset_input_destroy(input);
  if (!sub) throw new Error('hb_subset_or_fail');
  const outBlob = ex.hb_face_reference_blob(sub);
  const lenPtr = ex.malloc(4);
  const data = ex.hb_blob_get_data(outBlob, lenPtr);
  const len = new Uint32Array(ex.memory.buffer, lenPtr, 1)[0];
  const out = new Uint8Array(ex.memory.buffer, data, len).slice();
  ex.free(lenPtr);
  ex.hb_blob_destroy(outBlob);
  ex.hb_face_destroy(sub);
  ex.hb_face_destroy(face);
  ex.free(ptr);
  return out;
}

function coverage(bytes) {
  return new Set(new hb.Face(new hb.Blob(bytes)).collectUnicodes());
}

// ── 조각 나누기 ──
const inRange = (cp, a, b) => cp >= a && cp <= b;
/** KS X 1001 완성형 글자 (EUC-KR로 쓸 수 있는 것): 자주 쓰는 한글 2,350자, 한자 4,888자 */
function ksx1001(leadFrom, leadTo) {
  const dec = new TextDecoder('euc-kr');
  const out = [];
  for (let lead = leadFrom; lead <= leadTo; lead++)
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      const s = dec.decode(new Uint8Array([lead, trail]));
      if (s.length === 1 && s !== '�') out.push(s.codePointAt(0));
    }
  return new Set(out);
}
const KS_HANGUL = ksx1001(0xb0, 0xc8);
const KS_HANJA = ksx1001(0xca, 0xfd);
const isHangulSyllable = (cp) => inRange(cp, 0xac00, 0xd7a3);
const isJamo = (cp) => inRange(cp, 0x1100, 0x11ff) || inRange(cp, 0xa960, 0xa97f) || inRange(cp, 0xd7b0, 0xd7ff);
const isHan = (cp) => inRange(cp, 0x3400, 0x4dbf) || inRange(cp, 0x4e00, 0x9fff) || inRange(cp, 0xf900, 0xfaff) || cp >= 0x20000;
const isBase = (cp) =>
  cp < 0x250 || // 라틴·라틴-1·확장 A·B
  inRange(cp, 0x2000, 0x206f) || // 일반 문장부호
  inRange(cp, 0x20a0, 0x20cf) || // 통화
  inRange(cp, 0x2100, 0x22ff) || // 글자꼴 기호, 화살표, 수학 기호
  inRange(cp, 0x2460, 0x25ff) || // 원문자, 선, 도형
  inRange(cp, 0x3000, 0x303f) || // CJK 기호·문장부호
  inRange(cp, 0x3130, 0x318f) || // 한글 호환 자모
  inRange(cp, 0x3200, 0x33ff) || // 괄호·원 한글, CJK 호환
  inRange(cp, 0xff00, 0xffef) || // 전각
  KS_HANGUL.has(cp);

/** 정렬된 글자를 n개씩 */
function slices(cps, size) {
  const out = [];
  for (let i = 0; i < cps.length; i += size) out.push(cps.slice(i, i + size));
  return out;
}

function ranges(cps) {
  const out = [];
  for (const cp of cps) {
    const last = out[out.length - 1];
    if (last && last[1] === cp - 1) last[1] = cp;
    else out.push([cp, cp]);
  }
  return out;
}

/** 범위 목록 → 짧은 문자열 (packages/shaping/src/manifest.ts decodeCover) */
function encodeCover(rs) {
  let prev = -1;
  return rs
    .map(([a, b]) => {
      const s = (a - prev - 1).toString(36) + (b > a ? `.${(b - a).toString(36)}` : '');
      prev = b;
      return s;
    })
    .join(',');
}

function build({ id, name, file, plan, groupsFrom }) {
  const bytes = new Uint8Array(readFileSync(join(root, file)));
  const cover = [...coverage(bytes)].sort((a, b) => a - b);
  const set = new Set(cover);
  // groupsFrom: 다른 글꼴(같은 가족의 보통 굵기)과 같은 조각으로 자른다 → 조각 번호가 같은 자리를 가리킨다 (굵게 얼굴)
  const groups = groupsFrom ? groupsFrom.map(([chunk, cps]) => [chunk, cps.filter((cp) => set.has(cp))]) : plan(cover);
  const missing = groupsFrom ? cover.filter((cp) => !groupsFrom.some(([, cps]) => cps.includes(cp))).length : 0;
  if (missing) console.warn(`${name}: 보통 굵기 조각에 없는 글자 ${missing}개는 넣지 않음`);
  const dir = join(outDir, id);
  mkdirSync(dir, { recursive: true });
  const chunks = [];
  let total = 0;
  for (const [chunk, cps] of groups) {
    if (cps.length === 0) continue;
    const out = subset(bytes, cps);
    const f = `${chunk}.otf`;
    writeFileSync(join(dir, f), out);
    chunks.push({ name: chunk, file: f, bytes: out.length, count: cps.length, cover: encodeCover(ranges(cps)) });
    total += out.length;
  }
  const manifest = { id, name, file, chunks };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  console.log(`${name}: 원본 ${(bytes.length / 1e6).toFixed(2)} MB, 글자 ${cover.length.toLocaleString()}개 → 조각 ${chunks.length}개, 합 ${(total / 1e6).toFixed(2)} MB`);
  for (const c of chunks) console.log(`  ${c.name.padEnd(14)} ${String(c.count).padStart(6)}자 ${(c.bytes / 1e3).toFixed(0).padStart(5)} KB`);
  return { cover: set, groups };
}

const pretendardBuild = build({
  id: 'pretendard',
  name: 'Pretendard',
  file: 'fonts/pretendard/Pretendard-Regular.otf',
  plan(cps) {
    const base = cps.filter(isBase);
    const rest = cps.filter((cp) => isHangulSyllable(cp) && !KS_HANGUL.has(cp));
    const jamo = cps.filter(isJamo);
    const other = cps.filter((cp) => !isBase(cp) && !isHangulSyllable(cp) && !isJamo(cp));
    const per = Math.ceil(rest.length / 4);
    return [['base', base], ...slices(rest, per).map((s, i) => [`hangul-${i + 1}`, s]), ['jamo', jamo], ['other', other]];
  },
});

const pretendard = pretendardBuild.cover;

// 굵게 얼굴 (10 §4): 보통 굵기와 같은 조각으로
build({ id: 'pretendard-bold', name: 'Pretendard Bold', file: 'fonts/pretendard/Pretendard-Bold.otf', groupsFrom: pretendardBuild.groups });

build({
  id: 'noto-sans-kr',
  name: 'Noto Sans KR',
  file: 'fonts/noto-sans-kr/NotoSansKR-Regular.otf',
  // 대체 글꼴: Pretendard에 없는 글자만 (대부분 한자)
  plan(cps) {
    const missing = cps.filter((cp) => !pretendard.has(cp));
    const hanjaKs = missing.filter((cp) => KS_HANJA.has(cp));
    const hanjaRest = missing.filter((cp) => isHan(cp) && !KS_HANJA.has(cp));
    const other = missing.filter((cp) => !isHan(cp));
    return [...slices(hanjaKs, 1500).map((s, i) => [`hanja-${i + 1}`, s]), ...slices(hanjaRest, 1500).map((s, i) => [`hanja-x${i + 1}`, s]), ['other', other]];
  },
});
