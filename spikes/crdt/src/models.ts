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
