/**
 * 버전 비교 (14 §5.3, 4-6): 비교 문서를 모두 수락하면 B, 모두 거부하면 A (글자·서식·문단 속성).
 */
import { describe, expect, it } from 'vitest';
import type { Document } from '@quiredoc/model';
import { SyncBridge } from './index';
import { compareVersions, type Frontiers } from './compare';
import { documentFromLoro } from './shape';

const dump = (d: Document) => JSON.stringify(d.body.paragraphRuns());
const front = (b: SyncBridge): Frontiers => b.loro.frontiers().map((f) => ({ peer: String(f.peer), counter: f.counter }));
const at = (b: SyncBridge, f: Frontiers) => documentFromLoro(b.loro.forkAt(f as never));

describe('version compare (14 §5.3)', () => {
  it('shows inserts, deletes, formats and paragraph attributes between two versions', () => {
    const b = SyncBridge.create('하나 둘 셋\n넷 다섯', { peer: 1, batchMs: null });
    b.flush();
    const A = front(b);
    b.doc.insertText(3, '새 ');
    b.doc.deleteRange(5, 7); // '둘 '
    b.doc.format(0, 2, 'bold', true);
    b.doc.setParaAttr(1, 'align', 'center');
    b.flush();
    const B = front(b);
    const c = compareVersions(b.loro, A, B);
    const kinds = c.annotationRanges().map((r) => r.data.kind).sort();
    expect(kinds).toEqual(['delete', 'format', 'insert', 'para']);
    const cps = Array.from(c.body.text());
    const text = (kind: string) => c.annotationRanges().filter((r) => r.data.kind === kind).map((r) => cps.slice(r.from, r.to).join(''));
    expect(text('insert')).toEqual(['새 ']);
    expect(text('delete')).toEqual(['둘 ']);
    expect(c.annotationRanges().find((r) => r.data.kind === 'format')!.data.before).toEqual({ bold: null });
    const accept = compareVersions(b.loro, A, B);
    accept.resolveAll(true, undefined, false);
    expect(dump(accept)).toBe(dump(at(b, B)));
    const reject = compareVersions(b.loro, A, B);
    reject.resolveAll(false, undefined, false);
    expect(dump(reject)).toBe(dump(at(b, A)));
  });

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`randomized edits between two versions: accept-all = B, reject-all = A (seed ${seed})`, () => {
      let s = seed * 31337;
      const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 0x100000000);
      const b = SyncBridge.create('첫 문단 가나다\n둘째 문단 라마바\n셋째', { peer: 1, batchMs: null });
      // 다른 피어의 편집도 섞는다
      const other = SyncBridge.fromSnapshot(b.snapshot(), { peer: 2, batchMs: null });
      const edit = (x: SyncBridge, n: number) => {
        for (let k = 0; k < n; k++) {
          const len = x.doc.maxCaret;
          const p = Math.floor(r() * (len + 1));
          const t = r();
          if (t < 0.45) x.doc.insertText(p, r() < 0.15 ? '\n' : String.fromCharCode(0xac00 + Math.floor(r() * 40)));
          else if (t < 0.75 && len > 2) x.doc.deleteRange(Math.min(p, len - 1), Math.min(len, p + 1 + Math.floor(r() * 3)));
          else if (t < 0.9 && len > 2) {
            const a = Math.min(p, len - 1);
            x.doc.format(a, Math.min(len, a + 1 + Math.floor(r() * 4)), r() < 0.5 ? 'bold' : 'italic', r() < 0.7 ? true : undefined);
          } else x.doc.setParaAttr(Math.floor(r() * x.doc.paragraphs().length), 'align', r() < 0.5 ? 'center' : undefined);
        }
      };
      const sync = () => {
        b.flush();
        other.flush();
        other.receive(b.loro.export({ mode: 'update' }));
        b.receive(other.loro.export({ mode: 'update' }));
        b.flush();
        other.flush();
      };
      edit(b, 15);
      sync();
      const A = front(b);
      edit(b, 25);
      edit(other, 15);
      sync();
      const B = front(b);
      const accept = compareVersions(b.loro, A, B);
      expect(accept.annotationRanges().length).toBeGreaterThan(0);
      accept.resolveAll(true, undefined, false);
      expect(accept.body.text()).toBe(at(b, B).body.text());
      expect(dump(accept)).toBe(dump(at(b, B)));
      const reject = compareVersions(b.loro, A, B);
      reject.resolveAll(false, undefined, false);
      expect(dump(reject)).toBe(dump(at(b, A)));
      b.destroy();
      other.destroy();
    });
  }
});
