/**
 * 서식 의미론 스파이크 (10 §3, 단계 2-1) 도우미. 실제 문서 모양(@quiredoc/sync shape: 끝 표식 구획 M4 + 보초·자리표시)
 * 위에 Loro 텍스트 마크로 글자 서식과 문단 속성(¶ 글자의 마크 `p_<키>`; Loro 마크 키에는 ':'를 쓸 수 없다)을 건다.
 *
 * 화면 위치 ↔ Loro 위치: Doc(fromRaw)의 화면 오프셋을 u16OfOffset으로 저장 위치로 바꾼다. 옮긴 문단은 화면에서 이어져도
 * 저장 위치가 떨어져 있으므로, 서식 범위는 저장 위치가 이어진 조각마다 따로 건다.
 */
import { Doc } from '@quiredoc/model';
import { LoroWriter, readRaw, readState, SEG_MARK, TEXT, initLoro } from '@quiredoc/sync';
import { LoroDoc } from 'loro-crdt';

/** 글자 서식 키와 확장 규칙 (10 §2.6) */
export const EXPAND: Record<string, 'after' | 'none'> = {
  bold: 'after',
  italic: 'after',
  underline: 'after',
  color: 'after',
  size: 'after',
  link: 'none',
};
/** 문단 속성 키 (¶ 글자의 마크, 확장 없음) */
export const PARA_KEYS = ['align', 'list', 'style'];
export const pkey = (k: string) => `p_${k}`;

export function newPeer(peer: number): LoroDoc {
  const loro = new LoroDoc();
  loro.setPeerId(peer);
  configure(loro);
  return loro;
}

/** 서식 키 확장 규칙 설정 (모든 피어가 같아야 한다) */
export function configure(loro: LoroDoc): void {
  const styles: Record<string, { expand: 'after' | 'none' }> = { [SEG_MARK]: { expand: 'none' } };
  for (const [k, e] of Object.entries(EXPAND)) styles[k] = { expand: e };
  for (const k of PARA_KEYS) styles[pkey(k)] = { expand: 'none' };
  loro.configTextStyle(styles);
}

/** 처음 문서를 가진 피어 n개 (같은 스냅샷에서) */
export function peers(n: number, text: string): Peer[] {
  const first = newPeer(1);
  initLoro(first, text, 1);
  const snap = first.export({ mode: 'snapshot' });
  const out = [new Peer(first)];
  for (let k = 1; k < n; k++) {
    const l = newPeer(k + 1);
    l.import(snap);
    out.push(new Peer(l));
  }
  return out;
}

export class Peer {
  doc!: Doc;
  private writer!: LoroWriter;

  constructor(readonly loro: LoroDoc) {
    this.refresh();
  }

  /** Loro에서 Doc을 새로 만든다 (원격 업데이트를 가져온 뒤) */
  refresh(): void {
    const { raw, keys } = readRaw(this.loro);
    this.doc = Doc.fromRaw(raw, keys, readState(this.loro), this.loro.peerIdStr);
    this.writer = new LoroWriter(this.loro, () => this.doc.segmentOrder());
    this.doc.observe((c) => this.writer.apply(c));
  }

  private get text() {
    return this.loro.getText(TEXT);
  }

  /** 화면 범위 [a, b)의 저장 위치 조각들 */
  private rawRuns(a: number, b: number): Array<[number, number]> {
    const runs: Array<[number, number]> = [];
    for (let k = a; k < b; k++) {
      const u = this.doc.u16OfOffset(k);
      const last = runs[runs.length - 1];
      if (last && last[1] === u) last[1] = u + 1;
      else runs.push([u, u + 1]);
    }
    return runs;
  }

  /** 글자 서식 (value null = 해제) */
  format(a: number, b: number, key: string, value: unknown): void {
    for (const [s, e] of this.rawRuns(a, b)) {
      if (value === null) this.text.unmark({ start: s, end: e }, key);
      else this.text.mark({ start: s, end: e }, key, value);
    }
    this.loro.commit();
  }

  /** 문단 i의 ¶ 화면 위치 */
  paraEnd(i: number): number {
    return this.doc.paragraphs()[i]!.end;
  }

  /**
   * 문단 i의 속성 (value null = 해제). 실제 ¶가 없는 문단(동시 편집으로 생긴 가상 ¶, 09 §6)에는 걸 곳이 없어 false.
   */
  setPara(i: number, key: string, value: unknown): boolean {
    const u = this.doc.u16OfOffset(this.paraEnd(i));
    if (this.loro.getText(TEXT).toString()[u] !== '\n') return false;
    if (value === null) this.text.unmark({ start: u, end: u + 1 }, pkey(key));
    else this.text.mark({ start: u, end: u + 1 }, pkey(key), value);
    this.loro.commit();
    return true;
  }

  paraAttrs(i: number): Record<string, unknown> {
    return view(this.loro).paras[i]?.attrs ?? {};
  }

  /** 입력 (Loro의 확장 규칙이 서식을 정한다) */
  insert(at: number, s: string): void {
    this.doc.insertText(at, s);
    this.loro.commit();
  }

  delete(a: number, b: number): void {
    this.doc.deleteRange(a, b);
    this.loro.commit();
  }

  /**
   * Enter: 문단을 나누고 새 ¶(앞 문단)에 지금 문단의 속성을 복사한다 (10 §2.2).
   */
  split(at: number): void {
    const i = this.doc.paragraphIndexAt(at);
    const attrs = this.paraAttrs(i);
    this.insert(at, '\n');
    for (const [k, v] of Object.entries(attrs)) this.setPara(i, k, v);
  }

  /**
   * 문단 i와 i+1 합치기: 문단 i의 ¶를 지우고, 앞 문단(i)의 속성을 합친 문단(뒤 ¶)으로 복사한다 (10 §2.2 명령 규칙).
   */
  merge(i: number): void {
    const before = this.paraAttrs(i);
    const after = this.paraAttrs(i + 1);
    const end = this.paraEnd(i);
    this.delete(end, end + 1);
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) this.setPara(i, k, before[k] ?? null);
  }

  move(i: number, j: number, to: number): void {
    this.doc.moveParagraphs(i, j, to);
    this.loro.commit();
  }

  hide(i: number, j: number): void {
    this.doc.hideParagraphs(i, j);
    this.loro.commit();
  }
}

/** 업데이트를 모두 주고받는다 */
export function sync(ps: Peer[]): void {
  for (const a of ps)
    for (const b of ps) {
      if (a === b) continue;
      b.loro.import(a.loro.export({ mode: 'update', from: b.loro.oplogVersion() }));
    }
  for (const p of ps) p.refresh();
}

export interface View {
  text: string;
  /** 화면 글자마다 글자 서식 (¶는 빈 객체) */
  marks: Array<Record<string, unknown>>;
  paras: Array<{ text: string; attrs: Record<string, unknown> }>;
}

/** Loro 상태를 화면 순서로: 텍스트, 글자 서식, 문단 속성 */
export function view(loro: LoroDoc): View {
  const raw: Array<Record<string, unknown>> = [];
  for (const op of loro.getText(TEXT).toDelta()) {
    if (typeof op.insert !== 'string') continue;
    for (let i = 0; i < op.insert.length; i++) raw.push(op.attributes ?? {});
  }
  const { raw: rawText, keys } = readRaw(loro);
  const doc = Doc.fromRaw(rawText, keys, readState(loro));
  const text = doc.text();
  const marks: Array<Record<string, unknown>> = [];
  const paras: View['paras'] = [];
  let cur = '';
  for (let k = 0; k < text.length; k++) {
    const u = doc.u16OfOffset(k);
    // 가상 ¶: 구획 표식 자리에 화면에만 있는 문단 끝 (속성 없음)
    if (text[k] === '\n' && rawText[u] !== '\n') {
      paras.push({ text: cur, attrs: {} });
      cur = '';
      marks.push({});
      continue;
    }
    if (rawText[u] !== text[k]) throw new Error(`view: offset ${k} maps to ${JSON.stringify(rawText[u])}, expected ${JSON.stringify(text[k])}`);
    const a = raw[u] ?? {};
    if (text[k] === '\n') {
      const attrs: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(a)) if (key.startsWith('p_')) attrs[key.slice(2)] = v;
      paras.push({ text: cur, attrs });
      cur = '';
      marks.push({});
    } else {
      const m: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(a)) if (key in EXPAND) m[key] = v;
      marks.push(m);
      cur += text[k];
    }
  }
  return { text, marks, paras };
}

/** 서식이 key인 글자들을 문자열로 (비교용): 예) bold인 글자만 남기고 나머지는 · */
export function masked(v: View, key: string): string {
  return [...v.text].map((ch, k) => (ch === '\n' ? '/' : v.marks[k]![key] !== undefined ? ch : '·')).join('');
}
