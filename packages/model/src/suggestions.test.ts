/**
 * 제안 모드 기록 (14 §4, 4-3): 편집기의 commit처럼 명령 연산 뒤에 recordSuggestions를 부른다.
 * 기준: 모두 거부하면 제안 전 문서, 모두 수락하면 직접 편집한 문서 (글자), 서식·문단 제안은 처음 값을 기억한다.
 */
import { describe, expect, it } from 'vitest';
import { Doc, Document, History, type CommentAuthor, type Op } from './index';

const A: CommentAuthor = { id: 'ua', name: '가영', color: '#2563eb' };
const B: CommentAuthor = { id: 'ub', name: '나래', color: '#c2410c' };

function setup(text: string, author: CommentAuthor = A) {
  const doc = Doc.fromText(text);
  const d = new Document(doc);
  const h = new History();
  let t = 0;
  d.setSuggesting({ author, now: () => ++t });
  const pos = { anchor: doc.positionAt(0), head: doc.positionAt(0) };
  /** 명령 하나 = 트랜잭션 하나 (편집기 commit과 같다) */
  const run = (ops: Op[]) => {
    const all = [...ops, ...d.recordSuggestions(null, doc, ops)];
    h.seal();
    h.record({ ops: all, before: pos, after: pos, time: 0 });
    return all;
  };
  const ins = (at: number, s: string) => run([{ type: 'insert', ids: doc.insertText(at, s) }]);
  const del = (from: number, to: number) => run(doc.deleteRange(from, to));
  return { doc, d, h, run, ins, del };
}

/** 제안 목록 (종류, 작성자, 범위의 글자, 이전 값) */
function view(d: Document) {
  const cps = Array.from(d.body.text());
  return d
    .annotationRanges()
    .filter((r) => r.type === 'suggestion' && !r.orphan)
    .map((r) => {
      const v: Record<string, unknown> = { kind: r.data.kind, by: (r.data.author as CommentAuthor).id, text: cps.slice(r.from, r.to).join('') };
      if (r.data.before) v.before = r.data.before;
      return v;
    });
}

/** 모두 거부한 글자: 삽입 제안 글자를 빼고 (삭제 제안 글자는 남긴다) */
function rejectText(d: Document): string {
  const cps = Array.from(d.body.text());
  const drop = new Set<number>();
  for (const r of d.annotationRanges()) if (r.type === 'suggestion' && !r.orphan && r.data.kind === 'insert') for (let i = r.from; i < r.to; i++) drop.add(i);
  return cps.filter((_, i) => !drop.has(i)).join('');
}

/** 모두 수락한 글자: 삭제 제안 글자를 뺀다 */
function acceptText(d: Document): string {
  const cps = Array.from(d.body.text());
  const drop = new Set<number>();
  for (const r of d.annotationRanges()) if (r.type === 'suggestion' && !r.orphan && r.data.kind === 'delete') for (let i = r.from; i < r.to; i++) drop.add(i);
  return cps.filter((_, i) => !drop.has(i)).join('');
}

describe('suggestion mode recording (14 §4.1)', () => {
  it('records typing as one insert suggestion and keeps text out of it at both ends', () => {
    const { doc, d, ins } = setup('가나다라');
    ins(2, 'X');
    ins(3, 'Y');
    ins(4, 'Z');
    expect(doc.text()).toBe('가나XYZ다라\n');
    expect(view(d)).toEqual([{ kind: 'insert', by: 'ua', text: 'XYZ' }]);
  });

  it('does not delete in suggestion mode: marks a delete suggestion, merges backspaces, and really deletes my own insertions', () => {
    const { doc, d, ins, del } = setup('가나다라마');
    del(3, 4); // 라
    del(2, 3); // 다 (Backspace를 이어서)
    expect(doc.text()).toBe('가나다라마\n');
    expect(view(d)).toEqual([{ kind: 'delete', by: 'ua', text: '다라' }]);
    // 내가 넣은 글자를 지우면 실제로 지운다
    ins(1, 'XY');
    del(2, 3);
    expect(doc.text()).toBe('가X나다라마\n');
    expect(view(d)).toEqual([
      { kind: 'insert', by: 'ua', text: 'X' },
      { kind: 'delete', by: 'ua', text: '다라' },
    ]);
    // 이미 삭제 제안인 글자를 다시 지워도 그대로
    del(3, 5);
    expect(view(d).filter((v) => v.kind === 'delete')).toEqual([{ kind: 'delete', by: 'ua', text: '다라' }]);
  });

  it("marks another author's insertion as deleted instead of removing it", () => {
    const { doc, d, ins } = setup('가나다');
    ins(1, 'XY'); // A의 삽입
    d.setSuggesting({ author: B });
    const ops = doc.deleteRange(1, 3);
    d.recordSuggestions(null, doc, ops);
    expect(doc.text()).toBe('가XY나다\n');
    expect(view(d).sort((x, y) => String(y.kind).localeCompare(String(x.kind)))).toEqual([
      { kind: 'insert', by: 'ua', text: 'XY' },
      { kind: 'delete', by: 'ub', text: 'XY' },
    ]);
  });

  it('splits a delete suggestion when typing inside it; replacing a selection keeps the old text struck', () => {
    const { doc, d, ins, del, run } = setup('가나다라마바');
    del(1, 5); // 나다라마
    ins(3, 'Q'); // 다와 라 사이
    expect(doc.text()).toBe('가나다Q라마바\n');
    expect(view(d)).toEqual([
      { kind: 'delete', by: 'ua', text: '나다' },
      { kind: 'insert', by: 'ua', text: 'Q' },
      { kind: 'delete', by: 'ua', text: '라마' },
    ]);
    // 선택을 바꿔 쓰기 (편집기 replaceSelection: 지우고 그 자리에 넣기)
    const s = setup('하나 둘 셋');
    s.run([...s.doc.deleteRange(3, 4), { type: 'insert', ids: s.doc.insertText(3, '두') }]);
    expect(s.doc.text()).toBe('하나 두둘 셋\n');
    expect(view(s.d)).toEqual([
      { kind: 'insert', by: 'ua', text: '두' },
      { kind: 'delete', by: 'ua', text: '둘' },
    ]);
    expect(acceptText(s.d)).toBe('하나 두 셋\n');
    expect(rejectText(s.d)).toBe('하나 둘 셋\n');
    void run;
  });

  it('paragraph split and merge are character suggestions (¶ is an element)', () => {
    const { doc, d, ins, del } = setup('첫째둘째');
    ins(2, '\n');
    expect(doc.text()).toBe('첫째\n둘째\n');
    expect(view(d)).toEqual([{ kind: 'insert', by: 'ua', text: '\n' }]);
    // 내 ¶를 지우면 실제로 합친다
    del(2, 3);
    expect(doc.text()).toBe('첫째둘째\n');
    expect(view(d)).toEqual([]);
    // 원래 있던 ¶를 지우면 (문단 합치기 제안) ¶가 남고 삭제 제안
    const s = setup('하나\n둘');
    s.del(2, 3);
    expect(s.doc.text()).toBe('하나\n둘\n');
    expect(view(s.d)).toEqual([{ kind: 'delete', by: 'ua', text: '\n' }]);
  });

  it('records format suggestions per run of equal previous values and keeps the first value', () => {
    const { doc, d, run } = setup('가나다라마');
    // 다라는 원래 굵게 (제안 모드 전)
    d.setSuggesting(null);
    doc.format(2, 4, 'bold', true);
    d.setSuggesting({ author: A, now: () => 1 });
    run(doc.format(0, 5, 'bold', true)); // 바뀐 원소만: 가나, 마
    expect(view(d)).toEqual([
      { kind: 'format', by: 'ua', text: '가나', before: { bold: null } },
      { kind: 'format', by: 'ua', text: '마', before: { bold: null } },
    ]);
    // 같은 구간에 다른 키: 키를 더한다. 같은 키를 또 바꾸면 처음 값을 둔다
    run(doc.format(0, 2, 'italic', true));
    run(doc.format(0, 2, 'bold', false));
    expect(view(d)[0]).toEqual({ kind: 'format', by: 'ua', text: '가나', before: { bold: null, italic: null } });
  });

  it('records paragraph attribute suggestions on the ¶ and skips formatting of my own insertions', () => {
    const { doc, d, run, ins } = setup('하나\n둘');
    run(doc.setParaAttr(1, 'align', 'center'));
    run(doc.setParaAttr(1, 'align', 'right'));
    expect(view(d)).toEqual([{ kind: 'para', by: 'ua', text: '\n', before: { align: null } }]);
    ins(0, 'XY');
    run(doc.format(0, 2, 'bold', true)); // 내 삽입 안: 서식 제안 없음
    expect(view(d).map((v) => v.kind)).toEqual(['insert', 'para']);
  });

  it('undo removes the suggestion together with the edit', () => {
    const { doc, d, h, ins, del } = setup('가나다');
    ins(1, 'X');
    del(2, 3);
    h.undo(d);
    expect(view(d)).toEqual([{ kind: 'insert', by: 'ua', text: 'X' }]);
    h.undo(d);
    expect(doc.text()).toBe('가나다\n');
    expect(view(d)).toEqual([]);
    h.redo(d);
    h.redo(d);
    expect(view(d)).toEqual([
      { kind: 'insert', by: 'ua', text: 'X' },
      { kind: 'delete', by: 'ua', text: '나' },
    ]);
  });

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`randomized: reject-all gives the original text and accept-all matches direct editing (seed ${seed})`, () => {
      let s = seed * 9973;
      const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 0x100000000);
      const original = '하나 둘 셋\n넷 다섯 여섯\n일곱 여덟';
      const { doc, d, ins, del } = setup(original);
      // 직접 편집했을 때의 글자 (수락 결과의 기대값): 제안 문서의 오프셋을 "삭제 제안을 뺀 글자"의 오프셋으로 옮겨 적용한다
      let final = Array.from(original + '\n');
      const deleted = () => {
        const set = new Set<number>();
        for (const x of d.annotationRanges()) if (x.type === 'suggestion' && !x.orphan && x.data.kind === 'delete') for (let i = x.from; i < x.to; i++) set.add(i);
        return set;
      };
      const toFinal = (p: number, gone: Set<number>) => {
        let n = 0;
        for (let i = 0; i < p; i++) if (!gone.has(i)) n++;
        return n;
      };
      for (let step = 0; step < 120; step++) {
        const len = doc.maxCaret;
        const at = Math.floor(r() * (len + 1));
        const gone = deleted();
        if (r() < 0.55) {
          const t = r() < 0.15 ? '\n' : String.fromCharCode(0xac00 + Math.floor(r() * 50));
          const f = toFinal(at, gone);
          ins(at, t);
          final.splice(f, 0, t);
        } else if (len > 1) {
          const a = Math.min(at, len - 1);
          const b = Math.min(len, a + 1 + Math.floor(r() * 3));
          const fa = toFinal(a, gone);
          const fb = toFinal(b, gone);
          del(a, b);
          final.splice(fa, fb - fa);
        }
        expect(rejectText(d)).toBe(original + '\n');
        expect(acceptText(d)).toBe(final.join(''));
      }
      expect(view(d).length).toBeGreaterThan(0);
    });
  }
});
