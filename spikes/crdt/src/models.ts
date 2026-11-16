/**
 * 0단계 V4: 동기화 의도 보존 비교 (docs/design/05-collaboration-and-history.md §3, ADR-0003)
 *
 * 같은 편집 의도를 두 가지 문서 표현으로 구현하고, 동시 편집 후 결과를 비교한다.
 *
 * M1 — 평평한 텍스트: 스토리 전체가 LoroText 하나. 문단 끝마다 '\n'(¶).
 *      분할 = ¶ 삽입, 병합 = ¶ 삭제, 이동 = 문단 텍스트 삭제 후 다른 곳에 다시 삽입.
 * M2 — 이동 가능한 문단 리스트: LoroMovableList의 원소마다 LoroText 하나.
 *      분할 = 뒤쪽 텍스트를 잘라 새 문단 컨테이너에 넣음, 병합 = 뒤 문단 텍스트를 앞 문단에 붙이고 뒤 문단 삭제,
 *      이동 = 리스트의 move.
 *
 * 문단 안 위치(at)는 코드포인트 단위. 시나리오는 BMP 문자만 쓴다.
 */
import { LoroDoc, LoroText, UndoManager, type LoroMovableList } from 'loro-crdt';

export interface Replica {
  readonly doc: LoroDoc;
  insertText(p: number, at: number, text: string): void;
  deleteText(p: number, at: number, len: number): void;
  /** 문단 p를 at에서 둘로 나눈다 */
  split(p: number, at: number): void;
  /** 문단 p와 p+1을 합친다 */
  merge(p: number): void;
  /** 문단 from을 옮겨, 이동 후 인덱스가 to가 되게 한다 */
  move(from: number, to: number): void;
  /** 문단 p를 통째로 지운다 */
  deletePara(p: number): void;
  undo(): boolean;
  paragraphs(): string[];
  /** 모델이 보장해야 할 구조 조건 위반 (없으면 null) */
  invariantViolation(): string | null;
  /** 구획 모델만: 이웃한 구획 사이 BRK를 물리적으로 지운다 (정리 규칙 시험용) */
  compactPhysical?(): void;
  /** 구획 모델만: 크기 지표 */
  stats?(): SegStats;
}

export interface SegStats {
  /** 보이는 내용 글자 수 (숨긴 구획 포함, BRK 제외) */
  liveChars: number;
  /** 숨긴 구획에 남아 있는 글자 수 */
  hiddenChars: number;
  brk: number;
  orderLen: number;
  /** 텍스트 순서의 구획 수 */
  segs: number;
  /** 텍스트상으로도 화면상으로도 이웃한 구획을 하나로 볼 때의 구획 수 */
  runs: number;
  /** 위와 같되 숨긴 구획을 건너뛰고 셀 때 (화면 순서 계산이 실제로 다뤄야 할 조각 수) */
  visibleRuns: number;
}

export interface Model {
  name: string;
  /** 기준 문서를 만들고 스냅샷을 돌려준다 */
  createBase(paragraphs: string[]): Uint8Array;
  /** 스냅샷에서 피어를 만든다 */
  replica(snapshot: Uint8Array, peer: number): Replica;
}

function newDoc(peer: number): LoroDoc {
  const doc = new LoroDoc();
  doc.setPeerId(peer);
  return doc;
}

function undoManager(doc: LoroDoc): UndoManager {
  return new UndoManager(doc, { mergeInterval: 0, maxUndoSteps: 1000 });
}

// ── M1: 평평한 텍스트 ───────────────────────────────────────

class FlatReplica implements Replica {
  private readonly text: LoroText;
  private readonly undoMgr: UndoManager;

  constructor(readonly doc: LoroDoc) {
    this.text = doc.getText('body');
    this.undoMgr = undoManager(doc);
  }

  /** 문단 p의 시작 오프셋과 길이 (¶ 제외) */
  private para(p: number): { start: number; len: number } {
    const paras = this.raw().split('\n');
    let start = 0;
    for (let k = 0; k < p; k++) start += Array.from(paras[k]!).length + 1;
    return { start, len: Array.from(paras[p] ?? '').length };
  }

  private raw(): string {
    return this.text.toString();
  }

  insertText(p: number, at: number, text: string): void {
    this.text.insert(this.para(p).start + at, text);
    this.doc.commit();
  }

  deleteText(p: number, at: number, len: number): void {
    this.text.delete(this.para(p).start + at, len);
    this.doc.commit();
  }

  split(p: number, at: number): void {
    this.text.insert(this.para(p).start + at, '\n');
    this.doc.commit();
  }

  merge(p: number): void {
    const { start, len } = this.para(p);
    this.text.delete(start + len, 1); // 문단 p의 ¶
    this.doc.commit();
  }

  /**
   * 문단 p를 지울 때 삭제할 구간. 마지막 ¶(스토리 끝 표식)는 절대 지우지 않는다(01 §6):
   * 마지막 문단이면 "앞 문단의 ¶ + 내용"을 지운다. 그래야 동시에 마지막 문단 끝에 입력된 글자가
   * 스토리 끝 표식 뒤로 밀려나지 않는다.
   */
  private removalRange(p: number): { from: number; len: number; content: string } {
    const { start, len } = this.para(p);
    const content = Array.from(this.raw()).slice(start, start + len).join('');
    const last = p === this.paragraphs().length - 1;
    if (last && p > 0) return { from: start - 1, len: len + 1, content };
    return { from: start, len: len + 1, content };
  }

  move(from: number, to: number): void {
    const { from: at, len, content } = this.removalRange(from);
    this.text.delete(at, len);
    const n = this.paragraphs().length; // 이동 대상 문단을 뺀 문단 수
    if (to >= n) {
      // 맨 뒤로: 마지막 문단 뒤에 "¶ + 내용"을 붙여 스토리 끝 표식은 그대로 둔다
      const lastEnd = Array.from(this.raw()).length - 1; // 마지막 ¶ 위치
      this.text.insert(lastEnd, '\n' + content);
    } else {
      this.text.insert(this.para(to).start, content + '\n');
    }
    this.doc.commit();
  }

  deletePara(p: number): void {
    const { from, len } = this.removalRange(p);
    this.text.delete(from, len);
    this.doc.commit();
  }

  undo(): boolean {
    return this.undoMgr.undo();
  }

  paragraphs(): string[] {
    const parts = this.raw().split('\n');
    parts.pop(); // 마지막 ¶ 뒤의 빈 조각
    return parts;
  }

  invariantViolation(): string | null {
    const raw = this.raw();
    if (!raw.endsWith('\n')) return `스토리가 ¶로 끝나지 않음: ${JSON.stringify(raw.slice(-10))}`;
    return null;
  }
}

export const M1: Model = {
  name: 'M1 평평한 텍스트',
  createBase(paragraphs) {
    const doc = newDoc(1);
    doc.getText('body').insert(0, paragraphs.map((p) => p + '\n').join(''));
    doc.commit();
    return doc.export({ mode: 'snapshot' });
  },
  replica(snapshot, peer) {
    const doc = newDoc(peer);
    doc.import(snapshot);
    return new FlatReplica(doc);
  },
};

// ── M2: 이동 가능한 문단 리스트 ─────────────────────────────

class ListReplica implements Replica {
  private readonly list: LoroMovableList;
  private readonly undoMgr: UndoManager;

  constructor(readonly doc: LoroDoc) {
    this.list = doc.getMovableList('body');
    this.undoMgr = undoManager(doc);
  }

  private at(p: number): LoroText {
    return this.list.get(p) as unknown as LoroText;
  }

  insertText(p: number, at: number, text: string): void {
    this.at(p).insert(at, text);
    this.doc.commit();
  }

  deleteText(p: number, at: number, len: number): void {
    this.at(p).delete(at, len);
    this.doc.commit();
  }

  split(p: number, at: number): void {
    const t = this.at(p);
    const tail = Array.from(t.toString()).slice(at).join('');
    if (tail) t.delete(at, Array.from(tail).length);
    const n = this.list.insertContainer(p + 1, new LoroText());
    if (tail) n.insert(0, tail);
    this.doc.commit();
  }

  merge(p: number): void {
    const a = this.at(p);
    const b = this.at(p + 1).toString();
    if (b) a.insert(a.length, b);
    this.list.delete(p + 1, 1);
    this.doc.commit();
  }

  move(from: number, to: number): void {
    this.list.move(from, to);
    this.doc.commit();
  }

  deletePara(p: number): void {
    this.list.delete(p, 1);
    this.doc.commit();
  }

  undo(): boolean {
    return this.undoMgr.undo();
  }

  paragraphs(): string[] {
    const out: string[] = [];
    for (let k = 0; k < this.list.length; k++) out.push(this.at(k).toString());
    return out;
  }

  invariantViolation(): string | null {
    if (this.list.length === 0) return '문단이 하나도 없음';
    return null;
  }
}

export const M2: Model = {
  name: 'M2 이동 가능한 문단 리스트',
  createBase(paragraphs) {
    const doc = newDoc(1);
    const list = doc.getMovableList('body');
    paragraphs.forEach((p, k) => {
      const t = list.insertContainer(k, new LoroText());
      if (p) t.insert(0, p);
    });
    doc.commit();
    return doc.export({ mode: 'snapshot' });
  },
  replica(snapshot, peer) {
    const doc = newDoc(peer);
    doc.import(snapshot);
    return new ListReplica(doc);
  },
};

// ── M3: 평평한 텍스트 + 구획(segment) 순서 ──────────────────
//
// 내용은 M1처럼 LoroText 하나(¶ 문자로 문단 구분)에 두되, 텍스트를 보이지 않는 구획 표식(BRK)으로
// 여러 구획으로 나눈다. 구획의 ID = 그 구획을 시작하는 BRK 문자의 CRDT ID (첫 구획은 'root').
// 화면 순서는 텍스트 순서가 아니라 구획 ID들의 이동 가능한 리스트(order)가 정한다.
//
// - 입력·분할·병합: M1과 같은 텍스트 연산 (글자를 옮기지 않음)
// - 이동: 문단 앞뒤에 BRK를 넣어 그 문단만의 구획을 만들고, order에서 그 구획 ID만 옮긴다.
//         텍스트는 제자리에 있으므로 동시에 들어온 편집이 함께 움직인다.
// - 문단 삭제: 문단을 구획으로 떼어 낸 뒤 hidden에 표시해 숨긴다 (동시 편집도 함께 숨겨짐 = 삭제 우선)
//
// 결정적 표시 규칙 (모든 피어가 같은 상태에서 같은 결과):
// 1. order에 있는 구획을 그 순서대로 (중복·사라진 ID는 건너뜀)
// 2. order에 없는 구획(동시에 생긴 구획)은 텍스트 순서상 바로 앞의 표시된 구획 뒤에
// 3. hidden 구획은 표시하지 않음
// 4. 구획 끝에 ¶ 없이 남은 텍스트는 그 자체로 한 문단

const BRK = '';
const PARA = String.fromCharCode(10);
/** order 리스트 끝의 고정 항목 (구획 아님) */
const END = '$end';

interface Seg {
  /** 대표 ID (텍스트 순서상 첫 BRK) */
  id: string;
  /**
   * 이 구획을 가리키는 모든 ID. 두 피어가 같은 자리에 동시에 BRK를 넣으면 BRK가 연달아 생기고
   * 그 사이 구획은 비게 된다. 연달아 있는 BRK는 한 구획의 별칭으로 본다.
   */
  aliases: string[];
  /** 구획 내용의 텍스트 범위 [start, end) — BRK 제외 */
  start: number;
  end: number;
}

interface VPara {
  textStart: number;
  len: number;
  /** ¶로 끝나는가 (아니면 구획 끝에 남은 텍스트) */
  terminated: boolean;
  seg: Seg;
}

interface SegView {
  cps: string[];
  /** 텍스트 순서의 구획 */
  segs: Seg[];
  /** 화면 순서의 구획 (숨긴 구획 제외) */
  disp: Seg[];
  paras: VPara[];
  /** order 리스트의 현재 값 */
  order: string[];
}

class SegmentReplica implements Replica {
  private readonly text: LoroText;
  private readonly order: LoroMovableList;
  private readonly hidden: ReturnType<LoroDoc['getMap']>;
  /** 이동 명령으로 옮겨진 구획 (별칭 해석 시 우선) */
  private readonly moved: ReturnType<LoroDoc['getMap']>;
  private readonly undoMgr: UndoManager;
  /**
   * 보초 모드 (M4): 텍스트 끝은 늘 [BRK ¶]이고 마지막 구획('tail')은 그 ¶ 하나뿐인 보초다. 보초는 표시하지 않는다.
   * 사용자 문단은 모두 BRK로 끝나는 보통 구획에 있으므로 문단 삭제에 예외가 없다.
   */
  private readonly sentinel: boolean;

  /**
   * @param identity 구획 ID를 무엇으로 정하는가.
   *   'start' (M3): 구획을 시작하는 BRK. 문단을 떼어 내면 그 뒤 나머지 부분이 새 ID를 받는다.
   *   'end'   (M4): 구획을 끝내는 BRK (마지막 구획은 'tail'). 문단을 떼어 내도 그 뒤 나머지 부분은 원래 ID와
   *                 order 위치를 유지하고, 앞부분과 떼어 낸 문단만 새 ID를 받는다.
   */
  constructor(
    readonly doc: LoroDoc,
    private readonly identity: 'start' | 'end' = 'start',
    /** 문단 삭제 때 숨긴 구획의 내용도 같은 커밋에서 지운다 (정리 규칙 R2) */
    private readonly clearHidden = false,
  ) {
    this.sentinel = identity === 'end';
    this.text = doc.getText('body');
    this.order = doc.getMovableList('order');
    this.hidden = doc.getMap('hidden');
    this.moved = doc.getMap('moved');
    this.undoMgr = undoManager(doc);
  }

  private charId(pos: number): string {
    const p = this.text.getCursor(pos)?.pos();
    if (!p) throw new Error(`no char at ${pos}`);
    return `${p.peer}:${p.counter}`;
  }

  private view(): SegView {
    const cps = Array.from(this.text.toString());
    const segs = this.identity === 'end' ? this.segmentsByEnd(cps) : this.segmentsByStart(cps);
    const order = (this.order.toJSON() as string[]) ?? [];
    const all = this.arrange(segs, order);
    const disp = all.filter(
      (s) => !(this.sentinel && s.id === 'tail') && !s.aliases.some((a) => this.hidden.get(a) === true),
    );

    const paras: VPara[] = [];
    for (const s of disp) {
      let ps = s.start;
      for (let i = s.start; i < s.end; i++) {
        if (cps[i] === PARA) {
          paras.push({ textStart: ps, len: i - ps, terminated: true, seg: s });
          ps = i + 1;
        }
      }
      if (ps < s.end) paras.push({ textStart: ps, len: s.end - ps, terminated: false, seg: s });
    }
    return { cps, segs, disp, paras, order };
  }

  /** M4: 구획 = 다음 BRK 묶음(연달아 붙은 BRK)까지. ID = 그 BRK들 (별칭), 마지막 구획은 'tail' */
  private segmentsByEnd(cps: string[]): Seg[] {
    const segs: Seg[] = [];
    let start = 0;
    let i = 0;
    while (i < cps.length) {
      if (cps[i] !== BRK) {
        i++;
        continue;
      }
      const end = i;
      const ids: string[] = [];
      while (i < cps.length && cps[i] === BRK) ids.push(this.charId(i++));
      segs.push({ id: ids[0]!, aliases: ids, start, end });
      start = i;
    }
    segs.push({ id: 'tail', aliases: ['tail'], start, end: cps.length });
    return segs;
  }

  /** M3: 구획 = BRK 다음부터. ID = 시작 BRK, 첫 구획은 'root' */
  private segmentsByStart(cps: string[]): Seg[] {
    const segs: Seg[] = [];
    let cur: Seg = { id: 'root', aliases: ['root'], start: 0, end: 0 };
    for (let i = 0; i < cps.length; i++) {
      if (cps[i] === BRK) {
        const id = this.charId(i);
        if (i === cur.start) {
          // 바로 앞이 BRK(또는 문서 시작): 빈 구획 → 같은 구획의 별칭
          cur.aliases.push(id);
          cur.start = i + 1;
        } else {
          cur.end = i;
          segs.push(cur);
          cur = { id, aliases: [id], start: i + 1, end: 0 };
        }
      }
    }
    cur.end = cps.length;
    segs.push(cur);
    return segs;
  }

  /**
   * 화면 순서 (숨긴 구획 포함).
   * 구획 위치 = order에서 별칭의 위치. 별칭 중 이동 명령으로 옮겨진 것이 있으면 그것을 우선한다
   * (같은 자리에 동시에 BRK가 생길 때, "옮긴 문단"의 의도가 "나머지 부분"보다 우선).
   * 그 안에서는 가장 앞선 위치.
   */
  private arrange(segs: Seg[], order: string[]): Seg[] {
    const firstIndex = new Map<string, number>();
    order.forEach((id, k) => {
      if (!firstIndex.has(id)) firstIndex.set(id, k);
    });
    const listed: Array<{ seg: Seg; k: number }> = [];
    const unlisted: number[] = [];
    segs.forEach((seg, t) => {
      const movedAliases = seg.aliases.filter((a) => this.moved.get(a) === true && firstIndex.has(a));
      const candidates = movedAliases.length > 0 ? movedAliases : seg.aliases;
      let k = Infinity;
      for (const a of candidates) k = Math.min(k, firstIndex.get(a) ?? Infinity);
      if (k === Infinity) unlisted.push(t);
      else listed.push({ seg, k });
    });
    listed.sort((x, y) => x.k - y.k);
    const all = listed.map((x) => x.seg);
    if (this.identity === 'end') {
      // order에 없는 구획: 텍스트 순서상 다음 구획 바로 앞에 (뒤에서부터 처리)
      for (const t of [...unlisted].reverse()) {
        const at = t + 1 < segs.length ? all.indexOf(segs[t + 1]!) : all.length;
        all.splice(at < 0 ? all.length : at, 0, segs[t]!);
      }
    } else {
      // order에 없는 구획: 텍스트 순서상 앞 구획 바로 뒤에
      for (const t of unlisted) {
        const at = t === 0 ? -1 : all.indexOf(segs[t - 1]!);
        all.splice(at + 1, 0, segs[t]!);
      }
    }
    return all;
  }

  /** 구획이 order에 없으면, 화면에서 그 앞에 있는 구획 바로 뒤에 넣는다 */
  private ensureListed(segId: string): void {
    const v = this.view();
    const all = this.displayOrderWithHidden(v);
    const k = all.findIndex((s) => s.aliases.includes(segId));
    if (all[k]!.aliases.some((a) => v.order.includes(a))) return;
    if (this.identity === 'end') {
      // 화면에서 뒤에 있는 가장 가까운 구획 바로 앞에 (없으면 END 앞)
      let at = v.order.indexOf(END);
      for (let j = k + 1; j < all.length; j++) {
        const idxs = all[j]!.aliases.map((a) => v.order.indexOf(a)).filter((x) => x >= 0);
        if (idxs.length) {
          at = Math.min(...idxs);
          break;
        }
      }
      this.order.insert(at, segId);
      return;
    }
    let at = 0;
    for (let j = k - 1; j >= 0; j--) {
      const idx = Math.max(...all[j]!.aliases.map((a) => v.order.indexOf(a)));
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    this.order.insert(at, segId);
  }

  /** 구획(별칭 포함)이 화면 순서를 정할 때 쓰는 order 위치 (arrange와 같은 규칙) */
  private listIndex(segId: string): number {
    const v = this.view();
    const seg = v.segs.find((s) => s.aliases.includes(segId))!;
    const listedAliases = seg.aliases.filter((a) => v.order.includes(a));
    const movedAliases = listedAliases.filter((a) => this.moved.get(a) === true);
    const candidates = movedAliases.length > 0 ? movedAliases : listedAliases;
    let k = Infinity;
    for (const a of candidates) k = Math.min(k, v.order.indexOf(a));
    return k === Infinity ? -1 : k;
  }

  private displayOrderWithHidden(v: SegView): Seg[] {
    return this.arrange(v.segs, v.order);
  }

  /** 새 구획 newId를 order에서 구획 afterId 바로 뒤에 넣는다 */
  private listAfter(afterId: string, newId: string): void {
    this.ensureListed(afterId);
    this.order.insert(this.listIndex(afterId) + 1, newId);
  }

  /** 새 구획 newId를 order에서 구획 beforeId 바로 앞에 넣는다 */
  private listBefore(beforeId: string, newId: string): void {
    this.ensureListed(beforeId);
    this.order.insert(this.listIndex(beforeId), newId);
  }

  /** 문단 p가 혼자인 구획을 만들고 그 구획 ID를 돌려준다 */
  private isolate(p: number): string {
    if (this.identity === 'end') return this.isolateByEnd(p);
    let v = this.view();
    const P = v.paras[p]!;
    const s = P.seg;
    const endPos = P.textStart + P.len + (P.terminated ? 1 : 0);
    // 뒤쪽을 먼저 (앞쪽 위치가 바뀌지 않게)
    if (endPos < s.end) {
      this.text.insert(endPos, BRK);
      this.listAfter(s.id, this.charId(endPos));
    }
    if (P.textStart > s.start) {
      this.text.insert(P.textStart, BRK);
      const id = this.charId(P.textStart);
      this.listAfter(s.id, id);
      return id;
    }
    v = this.view();
    this.ensureListed(s.id);
    return s.id;
  }

  /**
   * M4: 문단 뒤에 BRK를 넣으면 [앞부분+문단]이 그 BRK를 ID로 받고 나머지는 원래 ID를 유지한다.
   * 문단 앞에도 BRK를 넣으면 [앞부분]이 새 ID를 받는다. 새 ID는 모두 원래 구획 바로 앞에 놓는다.
   */
  private isolateByEnd(p: number): string {
    const v = this.view();
    const P = v.paras[p]!;
    const s = P.seg;
    const endPos = P.textStart + P.len + (P.terminated ? 1 : 0);
    let pid = s.id;
    if (endPos < s.end) {
      this.text.insert(endPos, BRK);
      pid = this.charId(endPos);
      this.listBefore(s.id, pid);
    }
    if (P.textStart > s.start) {
      this.text.insert(P.textStart, BRK);
      this.listBefore(pid, this.charId(P.textStart));
    }
    this.ensureListed(pid);
    return pid;
  }

  /** 문단 p가 구획의 첫 문단이 되게 하고 그 구획 ID를 돌려준다 */
  private startSegmentAt(p: number): string {
    if (this.identity === 'end') {
      const v = this.view();
      const P = v.paras[p]!;
      if (P.textStart > P.seg.start) {
        // 앞부분이 새 ID를 받고 이 문단부터는 원래 구획 ID 그대로
        this.text.insert(P.textStart, BRK);
        this.listBefore(P.seg.id, this.charId(P.textStart));
      }
      this.ensureListed(P.seg.id);
      return P.seg.id;
    }
    const v = this.view();
    const P = v.paras[p]!;
    if (P.textStart === P.seg.start) {
      this.ensureListed(P.seg.id);
      return P.seg.id;
    }
    this.text.insert(P.textStart, BRK);
    const id = this.charId(P.textStart);
    this.listAfter(P.seg.id, id);
    return id;
  }

  /** 보초 모드에서 보이는 문단이 없으면 (가상의 빈 문단에 입력하려는 것) 실제 빈 문단 구획을 만든다 */
  private materialize(): void {
    if (!this.sentinel) return;
    const v = this.view();
    if (v.paras.length > 0) return;
    // 보초 구획 바로 앞에 [¶ BRK]: 새 구획은 order에 없으므로 텍스트상 다음 구획(보초) 앞에 놓인다
    this.text.insert(v.segs[v.segs.length - 1]!.start, PARA + BRK);
  }

  insertText(p: number, at: number, text: string): void {
    this.materialize();
    this.text.insert(this.view().paras[p]!.textStart + at, text);
    this.doc.commit();
  }

  deleteText(p: number, at: number, len: number): void {
    this.text.delete(this.view().paras[p]!.textStart + at, len);
    this.doc.commit();
  }

  split(p: number, at: number): void {
    this.materialize();
    this.text.insert(this.view().paras[p]!.textStart + at, '\n');
    this.doc.commit();
  }

  merge(p: number): void {
    const v = this.view();
    const a = v.paras[p]!;
    const b = v.paras[p + 1]!;
    const aEnd = a.textStart + a.len; // a의 ¶ 위치 또는 구획 끝
    if (a.terminated && b.textStart === aEnd + 1) {
      this.text.delete(aEnd, 1); // 같은 구획: ¶ 삭제
    } else if (!a.terminated && v.cps[aEnd] === BRK && b.textStart === aEnd + 1) {
      this.text.delete(aEnd, 1); // 텍스트상 바로 이어진 구획: BRK 삭제로 합침
    } else if (a.terminated && v.cps[aEnd + 1] === BRK && b.textStart === aEnd + 2) {
      this.text.delete(aEnd, 2); // ¶ + BRK
    } else {
      // 텍스트상 떨어진 문단 (이동된 구획 사이): 뒤 문단 내용을 복사해 붙이고 뒤 문단은 숨긴다
      const content = v.cps.slice(b.textStart, b.textStart + b.len).join('');
      if (content) this.text.insert(aEnd, content);
      this.removePara(p + 1);
    }
    this.doc.commit();
  }

  move(from: number, to: number): void {
    const sid = this.isolate(from);
    // 이동 대상 문단을 뺀 목록에서 to번째 문단 앞으로
    const v = this.view();
    const others = v.paras.filter((q) => !q.seg.aliases.includes(sid));
    let targetSeg: string | null = null;
    if (to < others.length) {
      const qIndex = v.paras.indexOf(others[to]!);
      targetSeg = this.startSegmentAt(qIndex);
    }
    const fromIdx = this.listIndex(sid);
    let toIdx: number;
    if (targetSeg === null) {
      // 맨 뒤로 = END 바로 앞으로 (동시에 다른 항목이 뒤에 추가되어도 "맨 뒤" 의도가 유지됨)
      const endIdx = (this.order.toJSON() as string[]).indexOf(END);
      toIdx = fromIdx < endIdx ? endIdx - 1 : endIdx;
    } else {
      const t = this.listIndex(targetSeg);
      toIdx = t > fromIdx ? t - 1 : t;
    }
    if (fromIdx !== toIdx) this.order.move(fromIdx, toIdx);
    // 실제로 옮긴 order 항목의 ID를 이동된 구획으로 표시
    this.moved.set((this.order.toJSON() as string[])[toIdx]!, true);
    this.doc.commit();
  }

  deletePara(p: number): void {
    this.removePara(p);
    this.doc.commit();
  }

  /**
   * 문단을 화면에서 없앤다. 구획으로 떼어 내 숨긴다(동시 편집도 함께 숨겨짐).
   * 보초 모드(M4)는 예외가 없다. M3는 문서의 마지막 ¶를 가진 문단을 숨기지 않고 텍스트를 지운다
   * (같은 구획 안의 앞 ¶도 함께 지워 문단 수를 줄임) — 이 예외가 S25의 원인이었다.
   */
  private removePara(p: number): void {
    const v = this.view();
    const P = v.paras[p]!;
    // M3: 이 문단의 ¶가 문서의 마지막 ¶인 경우만
    if (!this.sentinel && P.terminated && P.textStart + P.len === v.cps.length - 1) {
      const prevIsPara = P.textStart > P.seg.start && v.cps[P.textStart - 1] === PARA;
      if (prevIsPara) this.text.delete(P.textStart - 1, P.len + 1);
      else if (P.len > 0) this.text.delete(P.textStart, P.len);
      return;
    }
    const sid = this.isolate(p);
    this.hidden.set(sid, true);
    if (this.clearHidden) {
      // 구획 ID(BRK)와 숨김 표시는 남기고 내용만 지운다. 동시에 이 문단에 들어온 입력은 같은 구획에 들어가므로
      // 숨겨진 채로 남는다. 같은 커밋이라 실행 취소는 숨김과 내용을 함께 되돌린다.
      // 마지막 글자(¶) 하나는 남긴다: 구획이 비면 앞뒤 BRK가 맞붙어 별칭 규칙에 따라 이웃 구획과 한 구획이 되고,
      // 그 구획 전체가 숨겨진다 (첫 시험에서 동시 이동·병합과 만나 앞 문단이 사라짐).
      const s = this.view().segs.find((x) => x.aliases.includes(sid))!;
      if (s.end - 1 > s.start) this.text.delete(s.start, s.end - 1 - s.start);
    }
  }

  private isHidden(s: Seg): boolean {
    return s.aliases.some((a) => this.hidden.get(a) === true);
  }

  /**
   * 텍스트 순서상 이웃한 구획 쌍 [S, T] 중 하나로 볼 수 있는 것 (S의 인덱스).
   * 조건: 화면 순서(숨긴 구획 포함)에서도 바로 이웃, 둘 다 숨기지 않음, S가 ¶로 끝나거나 비어 있음.
   */
  private joinable(v: SegView): number[] {
    const all = this.arrange(v.segs, v.order);
    const rank = new Map(all.map((s, k) => [s, k]));
    const out: number[] = [];
    for (let t = 0; t + 1 < v.segs.length; t++) {
      const S = v.segs[t]!;
      const T = v.segs[t + 1]!;
      // 보초 앞 BRK는 지우면 안 된다 (사용자 문단이 표시하지 않는 보초 구획에 합쳐짐)
      if (this.sentinel && T.id === 'tail') continue;
      if (rank.get(T) !== rank.get(S)! + 1) continue;
      if (this.isHidden(S) || this.isHidden(T)) continue;
      if (S.end > S.start && v.cps[S.end - 1] !== PARA) continue;
      out.push(t);
    }
    return out;
  }

  /**
   * 정리 규칙 R3 시험: 하나로 볼 수 있는 구획 사이의 BRK를 지우고 order·moved 항목도 지운다.
   * 혼자 편집할 때는 화면이 그대로지만, 동시에 그 구획을 옮기거나 숨기는 편집과 만나면 의도가 깨진다.
   */
  compactPhysical(): void {
    const v = this.view();
    const ts = this.joinable(v);
    for (const t of ts.reverse()) {
      const S = v.segs[t]!;
      const T = v.segs[t + 1]!;
      this.text.delete(S.end, T.start - S.end);
      for (const a of S.aliases) {
        const k = (this.order.toJSON() as string[]).indexOf(a);
        if (k >= 0) this.order.delete(k, 1);
        this.moved.delete(a);
      }
    }
    this.doc.commit();
  }

  stats(): SegStats {
    const v = this.view();
    let brk = 0;
    for (const c of v.cps) if (c === BRK) brk++;
    let hiddenChars = 0;
    for (const s of v.segs) if (this.isHidden(s)) hiddenChars += s.end - s.start;
    return {
      liveChars: v.cps.length - brk,
      hiddenChars,
      brk,
      orderLen: v.order.length,
      segs: v.segs.length,
      runs: v.segs.length - this.joinable(v).length,
      visibleRuns: this.visibleRuns(v),
    };
  }

  /** 숨긴 구획을 건너뛰고 볼 때, 텍스트상으로도 화면상으로도 이웃한 보이는 구획을 하나로 센 수 */
  private visibleRuns(v: SegView): number {
    const vis = v.segs.filter((s) => !this.isHidden(s));
    const rank = new Map(v.disp.map((s, k) => [s, k]));
    let runs = vis.length;
    for (let i = 0; i + 1 < vis.length; i++) {
      const S = vis[i]!;
      const T = vis[i + 1]!;
      if (rank.get(T) !== rank.get(S)! + 1) continue;
      if (S.end > S.start && v.cps[S.end - 1] !== PARA) continue;
      runs--;
    }
    return runs;
  }

  undo(): boolean {
    return this.undoMgr.undo();
  }

  paragraphs(): string[] {
    const v = this.view();
    // 보초 모드: 보이는 문단이 없으면 가상의 빈 문단 하나 (문서에는 늘 문단이 하나 이상 보인다)
    if (this.sentinel && v.paras.length === 0) return [''];
    return v.paras.map((q) => v.cps.slice(q.textStart, q.textStart + q.len).join(''));
  }

  invariantViolation(): string | null {
    const raw = this.text.toString();
    if (!raw.endsWith('\n')) return `텍스트가 ¶로 끝나지 않음: ${JSON.stringify(raw.slice(-10))}`;
    if (this.sentinel) {
      const cps = Array.from(raw);
      if (cps[cps.length - 2] !== BRK) return `보초 구획이 ¶ 하나가 아님: ${JSON.stringify(raw.slice(-10))}`;
      return null;
    }
    if (this.view().paras.length === 0) return '보이는 문단이 없음';
    return null;
  }
}

export const M3: Model = {
  name: 'M3 평평한 텍스트 + 구획 순서',
  createBase(paragraphs) {
    const doc = newDoc(1);
    doc.getText('body').insert(0, paragraphs.map((p) => p + '\n').join(''));
    const order = doc.getMovableList('order');
    order.insert(0, 'root');
    order.insert(1, END); // "맨 뒤로" 이동의 기준점. 구획이 아니므로 표시하지 않음
    doc.commit();
    return doc.export({ mode: 'snapshot' });
  },
  replica(snapshot, peer) {
    const doc = newDoc(peer);
    doc.import(snapshot);
    return new SegmentReplica(doc);
  },
};

export const M4: Model = {
  name: 'M4 끝 표식 구획',
  createBase(paragraphs) {
    const doc = newDoc(1);
    const text = doc.getText('body');
    // 사용자 문단 + [BRK ¶] 보초
    const body = paragraphs.map((p) => p + PARA).join('');
    text.insert(0, body + BRK + PARA);
    const at = Array.from(body).length;
    const c = text.getCursor(at)!.pos()!;
    const order = doc.getMovableList('order');
    order.insert(0, `${c.peer}:${c.counter}`);
    order.insert(1, 'tail');
    order.insert(2, END);
    doc.commit();
    return doc.export({ mode: 'snapshot' });
  },
  replica(snapshot, peer) {
    const doc = newDoc(peer);
    doc.import(snapshot);
    return new SegmentReplica(doc, 'end');
  },
};

/** M4 + 문단 삭제 때 숨긴 내용 지우기 (정리 규칙 R2) */
export const M5: Model = {
  name: 'M4 + 숨긴 내용 삭제',
  createBase: M4.createBase,
  replica(snapshot, peer) {
    const doc = newDoc(peer);
    doc.import(snapshot);
    return new SegmentReplica(doc, 'end', true);
  },
};

/** 모든 피어가 서로의 변경을 받을 때까지 주고받는다 */
export function syncAll(...rs: Replica[]): void {
  for (let round = 0; round < 2; round++) {
    for (const a of rs) {
      for (const b of rs) {
        if (a === b) continue;
        b.doc.import(a.doc.export({ mode: 'update', from: b.doc.oplogVersion() }));
      }
    }
  }
}

/** a의 변경만 b에 전달 */
export function send(a: Replica, b: Replica): void {
  b.doc.import(a.doc.export({ mode: 'update', from: b.doc.oplogVersion() }));
}
