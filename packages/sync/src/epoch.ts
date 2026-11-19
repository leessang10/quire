/**
 * 새 판(epoch) 압축 (09 §9, V4 후속 3 R3).
 *
 * 편집 중에는 구획 표식(BRK)·순서 항목·숨긴 구획·묘비를 지울 수 없다 (동시 연산이 가리키는 ID라서). 아무도 편집하지 않을 때
 * 서버가 화면 텍스트로 **새 Loro 문서**를 만들어 판을 바꾼다. 판 ID는 Loro 맵 meta.epoch에 들어 있다 (첫 판은 '').
 *
 * 옛 판을 들고 있던 클라이언트가 다시 붙으면(오프라인 편집이 있을 수 있음) 재기반한다:
 *   F = 옛 판의 마지막 상태 (= 새 판의 처음 상태와 화면이 같음), M = F + 이 클라이언트의 변경
 *   새 판 = 새 판 처음 상태 + diff(F → M)
 * diff는 화면 텍스트의 문단·글자 차이라서, 오프라인 동안의 문단 이동은 "지우고 다시 넣기"가 된다.
 */
import { DEFAULT_STYLES, MARK_KEYS, OBJ_KEYS, PARA_KEYS, type Doc, type MarkKey } from '@quire/model';
import type { LoroDoc } from 'loro-crdt';
import { LoroWriter, docFromLoro, documentFromLoro, initLoro, insertChunked, newLoro, readTable, storyIdsOf, storyNames, tableIdsOf, writeFormats, writeTable, writeTableRecord, type PeerId } from './shape';
import type { Document } from '@quire/model';
import { writeAnnKey, writeAnnRange } from './annotations';
import { writeCmt } from './comments';

export const META = 'meta';

export function readEpoch(loro: LoroDoc): string {
  const v = loro.getMap(META).get('epoch');
  return typeof v === 'string' ? v : '';
}

/** 화면 텍스트(끝 ¶ 포함)로 새 판의 Loro 문서를 만든다. doc을 주면 그 서식·문단 속성·정의도 옮긴다 (10 §3) */
export function compactLoro(text: string, epoch: string, peer: PeerId, doc?: Doc): LoroDoc {
  const loro = newLoro(peer);
  initLoro(loro, text.endsWith('\n') ? text.slice(0, -1) : text, peer);
  if (doc) writeFormats(loro, doc);
  loro.getMap(META).set('epoch', epoch);
  loro.commit();
  return loro;
}

/** 버전 스냅샷(서버 GET /<방>/versions/<id>) → 읽기 전용으로 볼 문서 (14 §5.2) */
export function documentFromSnapshot(bytes: Uint8Array): Document {
  const loro = newLoro(0);
  loro.import(bytes);
  return documentFromLoro(loro);
}

/** 서식 있는 문서로 새 판을 만든다 (서버 압축·파일 열기) */
export function compactDoc(doc: Doc, epoch: string, peer: PeerId): LoroDoc {
  return compactLoro(doc.text(), epoch, peer, doc);
}

/** 여러 스토리 문서로 새 판을 만든다 (11 §2.5): 본문은 compactDoc과 같고, 스토리는 가벼운 모양 (구획 표식 없이) */
export function compactDocument(document: Document, epoch: string, peer: PeerId): LoroDoc {
  const loro = compactDoc(document.body, epoch, peer);
  for (const id of document.storyIds()) {
    const d = document.story(id);
    const text = d.text().slice(0, -1); // 유령 ¶ 빼고
    const names = storyNames(id);
    if (text === '' && d.plain && Object.keys(d.paraAttrs(0)).length === 0) continue; // 빈 스토리는 쓰지 않는다
    insertChunked(loro.getText(names.text), 0, text);
    writeFormats(loro, d, names);
  }
  for (const id of document.tableIds()) writeTableRecord(loro, document.table(id)!);
  // 주석 (14 §2.3): 새 판의 텍스트에 커서를 다시 만든다 (화면 오프셋이 같으므로 새 Loro로 만든 Doc에서 UTF-16을 구한다)
  const ids = document.annotationIds();
  if (ids.length) {
    loro.commit();
    const fresh = new Map<string | null, Doc>();
    const docAt = (story: string | null): Doc => {
      const hit = fresh.get(story);
      if (hit) return hit;
      const d = docFromLoro(loro, String(peer), story ?? undefined);
      fresh.set(story, d);
      return d;
    };
    for (const id of ids.sort()) {
      const a = document.annotation(id)!;
      writeAnnKey(loro, id, 'type', a.type);
      writeAnnKey(loro, id, 'story', a.story);
      writeAnnKey(loro, id, 'data', a.data);
      const range = document.resolveRange(a);
      if (!range || range.orphan || range.to <= range.from) writeAnnRange(loro, id, a.story, { start: null, last: null });
      else {
        const d = docAt(a.story);
        writeAnnRange(loro, id, a.story, { start: d.u16OfOffset(range.from), last: d.u16OfOffset(range.to - 1) });
      }
    }
  }
  // 댓글 키 (14 §3): 그대로
  for (const [k, v] of document.commentKeys()) writeCmt(loro, k, v);
  loro.commit();
  return loro;
}

/** a를 b로 바꾸는 변경 (a 기준 코드포인트 위치, 앞에서부터, 겹치지 않음) */
export interface Hunk {
  at: number;
  del: number;
  ins: string;
}

const LCS_LIMIT = 4_000_000;
/** 줄 diff에서 허용하는 최대 편집 거리 (넘으면 LCS 또는 한 덩어리로) */
const MYERS_MAX_D = 2000;

/**
 * 문단 단위로 맞춘 뒤, 바뀐 구간 안에서는 글자 단위로 나눈다. 줄 맞추기는 Myers(편집 거리 D에 비례: 큰 문서의
 * 몇 군데만 바뀐 경우에 빠름)이고, D가 너무 크면 작은 구간은 LCS, 큰 구간은 한 덩어리로 바꾼다.
 */
export function diffText(a: string, b: string): Hunk[] {
  if (a === b) return [];
  const A = lines(a);
  const B = lines(b);
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const n = A.length - s - e;
  const m = B.length - s - e;
  // 같은 줄 짝 (A 인덱스, B 인덱스), 바뀐 구간 사이의 고정점
  let mid: Array<[number, number]> = [];
  if (n > 0 && m > 0) {
    const a2 = A.slice(s, s + n);
    const b2 = B.slice(s, s + m);
    mid = myersPairs(a2, b2, MYERS_MAX_D) ?? (n * m <= LCS_LIMIT ? lcsPairs(a2, b2) : []);
  }
  const pairs = mid.map(([i, j]) => [s + i, s + j] as [number, number]);
  pairs.push([A.length - e, B.length - e]);
  // 줄 시작의 코드포인트 위치
  const startA = starts(A);
  const out: Hunk[] = [];
  let ai = s;
  let bi = s;
  for (const [pa, pb] of pairs) {
    if (pa > ai || pb > bi) {
      const oldS = A.slice(ai, pa).join('');
      const newS = B.slice(bi, pb).join('');
      out.push(...refine(startA[ai]!, oldS, newS));
    }
    ai = pa + 1;
    bi = pb + 1;
  }
  return out;
}

const CHAR_LCS_LIMIT = 1_000_000;

/** 바뀐 문단 구간 안의 글자 차이: 앞뒤 같은 글자를 덜어 내고, 작으면 글자 LCS로 나눈다 */
function refine(at: number, oldS: string, newS: string): Hunk[] {
  const o = Array.from(oldS);
  const nw = Array.from(newS);
  let p = 0;
  while (p < o.length && p < nw.length && o[p] === nw[p]) p++;
  let q = 0;
  while (q < o.length - p && q < nw.length - p && o[o.length - 1 - q] === nw[nw.length - 1 - q]) q++;
  const oo = o.slice(p, o.length - q);
  const nn = nw.slice(p, nw.length - q);
  if (oo.length === 0 && nn.length === 0) return [];
  if (oo.length === 0 || nn.length === 0 || oo.length * nn.length > CHAR_LCS_LIMIT) return [{ at: at + p, del: oo.length, ins: nn.join('') }];
  const pairs = lcsPairs(oo, nn);
  pairs.push([oo.length, nn.length]);
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    if (pi > i || pj > j) out.push({ at: at + p + i, del: pi - i, ins: nn.slice(j, pj).join('') });
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

/**
 * Myers 차이 (O((N+M)·D) 시간, O(D²) 메모리). 같은 원소 짝을 앞에서부터 돌려준다. 편집 거리가 maxD를 넘으면 null.
 */
function myersPairs(A: string[], B: string[], maxD: number): Array<[number, number]> | null {
  const n = A.length;
  const m = B.length;
  const limit = Math.min(n + m, maxD);
  const o = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  // trace[d]: d 단계 직전의 v[-d-1 .. d+1]
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(o - d - 1, o + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[o + k - 1]! < v[o + k + 1]!) ? v[o + k + 1]! : v[o + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[o + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], dEnd: number, n: number, m: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d >= 0; d--) {
    const t = trace[d]!;
    const at = (k: number) => t[k + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    // 대각선(같은 원소)을 거슬러 올라간다
    const startX = d === 0 ? 0 : prevK === k + 1 ? prevX : prevX + 1;
    while (x > startX && y > (d === 0 ? 0 : startX - k)) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  return pairs.reverse();
}

/** 최장 공통 부분열의 짝 (A 인덱스, B 인덱스) */
function lcsPairs(A: string[], B: string[]): Array<[number, number]> {
  const n = A.length;
  const m = B.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function lines(s: string): string[] {
  return s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function starts(ls: string[]): number[] {
  const out = new Array<number>(ls.length + 1);
  let at = 0;
  for (let i = 0; i < ls.length; i++) {
    out[i] = at;
    at += cpLength(ls[i]!);
  }
  out[ls.length] = at;
  return out;
}

function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xd800 || c > 0xdbff || i + 1 >= s.length) n++;
    else {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
      n++;
    }
  }
  return n;
}

/** 서버가 보낸 재기반 정보 */
export interface RebaseInfo {
  /** 새 판 ID */
  epoch: string;
  /** 옛 판의 마지막 버전 벡터 (비었으면 서버가 옛 판을 모름: 로컬 변경을 살릴 수 없음). 진단·확인용 */
  oldVV: Uint8Array;
  /** 옛 판에서 이쪽에 없는 업데이트 */
  update: Uint8Array;
  /** 새 판의 처음 상태 스냅샷 */
  base: Uint8Array;
}

/**
 * 옛 판 문서 old(이쪽 변경 포함)를 새 판으로 옮긴다. lost: 서버가 옛 판을 몰라 이쪽 변경을 버렸는가.
 * old는 옛 판 업데이트를 가져오므로 바뀐다 (버릴 문서).
 */
export function rebaseOnto(old: LoroDoc, info: RebaseInfo, peer: PeerId): { loro: LoroDoc; lost: boolean } {
  const fresh = newLoro(peer);
  fresh.import(info.base);
  if (info.oldVV.length === 0) return { loro: fresh, lost: true };
  if (info.update.length) old.import(info.update);
  // F의 화면 = 새 판 처음 상태의 화면 (서버가 F의 화면·서식으로 새 판을 만든다). 옛 문서를 F 시점으로
  // 갈라 읽는 것(forkAt)보다 훨씬 싸다: 10만 문단에서 13초 → 새 판은 어차피 읽어야 한다
  const document = documentFromLoro(fresh);
  const target = documentFromLoro(old);
  // 본문과 스토리마다: 텍스트 차이를 적용하고 서식 차이를 맞춘다 (옛 판에만 있는 스토리도 새 판에서 빈 스토리로 시작)
  const ids = [null, ...new Set([...storyIdsOf(fresh), ...storyIdsOf(old)])];
  for (const id of ids) {
    const doc = id === null ? document.body : document.story(id);
    const want = id === null ? target.body : target.story(id);
    const writer = new LoroWriter(fresh, () => doc.segmentOrder(), id === null ? undefined : storyNames(id));
    doc.observe((c) => writer.apply(c));
    applyHunks(doc, diffText(doc.text(), want.text()));
    syncFormats(doc, want);
    doc.observe(null);
  }
  // 표 레코드: 옛 판의 레코드와 같게 (행·열 목록에 없는 ID를 넣고, 맵 항목을 맞춘다)
  for (const id of tableIdsOf(old)) {
    const want = readTable(old, id);
    const have = readTable(fresh, id);
    for (const list of ['rows', 'cols'] as const) {
      let prev: string | null = null;
      for (const x of want[list]) {
        if (!have[list].includes(x)) writeTable(fresh, { kind: 'tableList', table: id, list, id: x, after: prev });
        prev = x;
      }
    }
    const pairs: Array<[import('@quire/model').TableMapName, Record<string, unknown>, Record<string, unknown>]> = [
      ['gone', want.gone, have.gone], ['w', want.widths, have.widths], ['span', want.spans, have.spans],
      ['ra', want.rowAttrs, have.rowAttrs], ['ca', want.cellAttrs, have.cellAttrs], ['attrs', want.attrs as Record<string, unknown>, have.attrs as Record<string, unknown>],
    ];
    for (const [map, w, h] of pairs)
      for (const key of new Set([...Object.keys(w), ...Object.keys(h)]))
        if (JSON.stringify(w[key]) !== JSON.stringify(h[key])) writeTable(fresh, { kind: 'tableMap', table: id, map, key, value: w[key] });
  }
  fresh.commit();
  return { loro: fresh, lost: false };
}

/**
 * 화면 텍스트가 같은 두 문서에서 doc의 서식을 target과 같게 한다 (doc의 연산으로: 변경 기록이 나간다).
 * 글자 서식은 키마다 값이 같은 구간으로 묶어 format 한 번씩, 문단 속성은 문단 순서대로 짝지어, 정의는 이름·id로.
 */
export function syncFormats(doc: Doc, target: Doc): void {
  if (doc.text() !== target.text()) throw new Error('syncFormats: texts differ');
  if (doc.plain && target.plain) return;
  const same = (x: unknown, y: unknown) => x === y || (x !== undefined && y !== undefined && JSON.stringify(x) === JSON.stringify(y));
  const n = target.paragraphs().length;
  for (let i = 0; i < n; i++) {
    const pa = doc.paragraphs()[i]!;
    const pb = target.paragraphs()[i]!;
    // 양쪽 다 서식·속성이 없는 문단은 건너뛴다 (큰 문서 재기반의 대부분)
    if (!pa.fmt && !pb.fmt && pa.mark === 0 && pb.mark === 0 && !hasKeys(pa.attrs) && !hasKeys(pb.attrs) && !pa.objs && !pb.objs) continue;
    // 개체 속성 (같은 위치의 개체끼리)
    if (pb.objs)
      for (const [k, ob] of pb.objs) {
        const oa = doc.paragraphs()[i]!.objs?.get(k) ?? {};
        for (const key of OBJ_KEYS) if (!same((oa as Record<string, unknown>)[key], ob[key])) doc.setObjAttr(pa.start + k, key, ob[key]);
      }
    const len = pb.end - pb.start + 1; // ¶ 포함
    const want = (k: number) => (k < len - 1 ? (pb.fmt ? pb.fmt[k]! : 0) : pb.mark);
    const have = (k: number) => {
      const p = doc.paragraphs()[i]!;
      return k < len - 1 ? (p.fmt ? p.fmt[k]! : 0) : p.mark;
    };
    for (const key of MARK_KEYS as readonly MarkKey[]) {
      let k = 0;
      while (k < len) {
        const v = target.markSet(want(k))[key];
        if (same(doc.markSet(have(k))[key], v)) {
          k++;
          continue;
        }
        let j = k + 1;
        while (j < len && same(target.markSet(want(j))[key], v) && !same(doc.markSet(have(j))[key], v)) j++;
        doc.format(pa.start + k, pa.start + j, key, v);
        k = j;
      }
    }
    const aa = doc.paraAttrs(i);
    const ab = target.paraAttrs(i);
    for (const key of PARA_KEYS) if (!same(aa[key], ab[key])) doc.setParaAttr(i, key, ab[key]);
  }
  if (doc.isStory) return; // 스타일·목록 정의는 문서에 하나 (본문에서 맞춘다)
  const names = new Set([...doc.styles().map((st) => st.name), ...target.styles().map((st) => st.name), ...DEFAULT_STYLES.map((st) => st.name)]);
  for (const name of names) if (!same(doc.style(name), target.style(name))) doc.setStyle(name, target.style(name));
  const ids = new Set([...doc.lists().map((l) => l.id), ...target.lists().map((l) => l.id)]);
  for (const id of ids) if (!same(doc.listDef(id), target.listDef(id))) doc.setList(id, target.listDef(id));
  const secs = new Set([...doc.sectionDefs().map(([id]) => id), ...target.sectionDefs().map(([id]) => id)]);
  for (const id of secs) if (!same(doc.sectionDef(id), target.sectionDef(id))) doc.setSection(id, target.sectionDef(id));
}

/**
 * 뒤에서부터 적용해 앞 변경의 위치가 그대로 맞게 한다. 문서의 마지막 ¶ 뒤에는 캐럿을 둘 수 없으므로, 문서 끝에 닿는 변경은
 * 같은 결과가 되도록 한 칸 앞으로 옮긴다 ("…¶" 뒤에 "X¶" 넣기 = 마지막 ¶ 앞에 "¶X" 넣기).
 */
export function applyHunks(doc: Doc, hunks: Hunk[]): void {
  for (let k = hunks.length - 1; k >= 0; k--) {
    let h = hunks[k]!;
    const len = doc.length;
    if (len > 0 && h.at + h.del === len) {
      if (h.at > 0 && (h.ins.endsWith('\n') || (h.ins === '' && doc.slice(h.at - 1, h.at) === '\n')))
        h = { at: h.at - 1, del: h.del, ins: h.ins ? `\n${h.ins.slice(0, -1)}` : '' };
      else if (h.at === 0) h = { at: 0, del: h.del - 1, ins: h.ins.endsWith('\n') ? h.ins.slice(0, -1) : h.ins };
    }
    if (h.del > 0) doc.deleteRange(h.at, h.at + h.del);
    if (h.ins) doc.insertText(h.at, h.ins);
  }
}

/**
 * 같은 바탕에서 나온 두 변경 중 ours를 theirs 뒤의 좌표로 옮긴다 (둘 다 바탕 좌표, 앞에서부터).
 * 같은 자리 입력은 theirs가 앞에 온다 (ot.ts와 같은 규칙). ours가 지운 범위 안에서 theirs가 바꾼 부분은 theirs를 따른다.
 */
export function rebaseHunks(ours: Hunk[], theirs: Hunk[]): Hunk[] {
  const lens = theirs.map((t) => cpLength(t.ins));
  const map = (p: number, side: 'start' | 'end'): number => {
    let shift = 0;
    for (let k = 0; k < theirs.length; k++) {
      const t = theirs[k]!;
      const end = t.at + t.del;
      // 같은 자리: 지울 범위의 끝은 theirs 입력 앞, 시작·입력은 theirs 입력 뒤
      if (p < t.at || (p === t.at && (t.del > 0 || side === 'end'))) break;
      if (p === t.at || p >= end) {
        shift += lens[k]! - t.del;
        continue;
      }
      // theirs가 바꾼 범위 안
      return t.at + shift + (side === 'start' ? lens[k]! : 0);
    }
    return p + shift;
  };
  const out: Hunk[] = [];
  for (const h of ours) {
    // 지울 범위에서 theirs가 바꾼 부분과 theirs가 안에 넣은 자리를 빼고 조각낸다
    const pieces: Array<[number, number]> = [];
    let cur = h.at;
    const end = h.at + h.del;
    for (const t of theirs) {
      if (t.at < cur && t.at + t.del <= cur) continue;
      if (t.at >= end) break;
      if (t.at > cur) pieces.push([cur, t.at]);
      cur = Math.max(cur, t.at + t.del);
    }
    if (cur < end) pieces.push([cur, end]);
    let ins = h.ins;
    if (pieces.length === 0 && ins) out.push({ at: map(h.at, 'start'), del: 0, ins });
    for (const [a, b] of pieces) {
      const at = map(a, 'start');
      out.push({ at, del: map(b, 'end') - at, ins });
      ins = '';
    }
  }
  return out;
}

function hasKeys(o: object): boolean {
  for (const _ in o) return true;
  return false;
}
