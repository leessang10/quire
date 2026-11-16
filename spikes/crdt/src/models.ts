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

  constructor(readonly doc: LoroDoc) {
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

    const order = (this.order.toJSON() as string[]) ?? [];
    const all = this.arrange(segs, order);
    const disp = all.filter((s) => !s.aliases.some((a) => this.hidden.get(a) === true));

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
    // order에 없는 구획: 텍스트 순서상 앞 구획 바로 뒤에
    for (const t of unlisted) {
      const at = t === 0 ? -1 : all.indexOf(segs[t - 1]!);
      all.splice(at + 1, 0, segs[t]!);
    }
    return all;
  }

  /** 구획이 order에 없으면, 화면에서 그 앞에 있는 구획 바로 뒤에 넣는다 */
  private ensureListed(segId: string): void {
    const v = this.view();
    const all = this.displayOrderWithHidden(v);
    const k = all.findIndex((s) => s.aliases.includes(segId));
    if (all[k]!.aliases.some((a) => v.order.includes(a))) return;
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

  /** 문단 p가 혼자인 구획을 만들고 그 구획 ID를 돌려준다 */
  private isolate(p: number): string {
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

  /** 문단 p가 구획의 첫 문단이 되게 하고 그 구획 ID를 돌려준다 */
  private startSegmentAt(p: number): string {
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

  insertText(p: number, at: number, text: string): void {
    this.text.insert(this.view().paras[p]!.textStart + at, text);
    this.doc.commit();
  }

  deleteText(p: number, at: number, len: number): void {
    this.text.delete(this.view().paras[p]!.textStart + at, len);
    this.doc.commit();
  }

  split(p: number, at: number): void {
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
   * 문단을 화면에서 없앤다. 보통은 구획으로 떼어 내 숨긴다(동시 편집도 함께 숨겨짐).
   * 단, 문서의 마지막 ¶를 가진 문단은 숨기지 않는다 — 그 구획이 늘 보이므로 보이는 문단이 하나 이상 남는다.
   * 그 문단은 텍스트를 지운다 (같은 구획 안의 앞 ¶도 함께 지워 문단 수를 줄임).
   */
  private removePara(p: number): void {
    const v = this.view();
    const P = v.paras[p]!;
    // 이 문단의 ¶가 문서의 마지막 ¶인 경우만
    if (P.terminated && P.textStart + P.len === v.cps.length - 1) {
      const prevIsPara = P.textStart > P.seg.start && v.cps[P.textStart - 1] === PARA;
      if (prevIsPara) this.text.delete(P.textStart - 1, P.len + 1);
      else if (P.len > 0) this.text.delete(P.textStart, P.len);
      return;
    }
    const sid = this.isolate(p);
    this.hidden.set(sid, true);
  }

  undo(): boolean {
    return this.undoMgr.undo();
  }

  paragraphs(): string[] {
    const v = this.view();
    return v.paras.map((q) => v.cps.slice(q.textStart, q.textStart + q.len).join(''));
  }

  invariantViolation(): string | null {
    const raw = this.text.toString();
    if (!raw.endsWith('\n')) return `텍스트가 ¶로 끝나지 않음: ${JSON.stringify(raw.slice(-10))}`;
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
