/**
 * Doc.batch (다중 커서, 11 §5.2): 뒤에서 앞으로 하는 여러 곳 편집에서 문단 시작 옮기기를 끝에 한 번만 한다.
 * 결과(문단 목록·바뀐 구간)가 하나씩 한 것과 같은가
 */
import { describe, expect, it } from 'vitest';
import { Doc } from './doc';

const NL = String.fromCharCode(10);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const view = (d: Doc) => d.paragraphs().map((p) => [p.start, p.end, p.text]);

describe('Doc.batch', () => {
  for (const seed of Array.from({ length: 30 }, (_, k) => k + 1)) {
    it(`matches one-by-one edits, seed ${seed}`, () => {
      const r = rng(seed * 101);
      const text = Array.from({ length: 40 }, (_, i) => `${i} 문단 가나다 ab`).join(NL);
      const a = Doc.fromText(text);
      const b = Doc.fromText(text);
      for (let round = 0; round < 30; round++) {
        // 겹치지 않는 캐럿 (뒤에서 앞으로)
        const n = 1 + Math.floor(r() * 12);
        const offs = [...new Set(Array.from({ length: n }, () => Math.floor(r() * a.maxCaret)))].sort((x, y) => y - x);
        const edits = offs.map((o, k) => {
          const roll = r();
          const room = k === 0 ? a.maxCaret - o : offs[k - 1]! - o;
          if (roll < 0.5) return { kind: 'ins' as const, o, t: ['가', NL, `x${NL}y`, '😀'][Math.floor(r() * 4)]! };
          const len = Math.min(room, 1 + Math.floor(r() * 4));
          return len > 0 ? { kind: 'del' as const, o, len } : { kind: 'ins' as const, o, t: '나' };
        });
        const run = (d: Doc) => {
          for (const e of edits) e.kind === 'ins' ? d.insertText(e.o, e.t) : d.deleteRange(e.o, e.o + e.len);
        };
        a.batch(() => run(a));
        run(b);
        expect(view(a), `seed ${seed} round ${round}`).toEqual(view(b));
        expect(a.text()).toBe(b.text());
        expect(a.takeParagraphChanges()).toEqual(b.takeParagraphChanges());
      }
    });
  }
});
