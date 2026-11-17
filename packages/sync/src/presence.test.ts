/**
 * 공유 위치(Loro 커서)와 프레즌스 시험 (09 §7)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { History } from '@quire/model';
import { Presence } from './presence';
import { SyncBridge } from './index';

const NL = String.fromCharCode(10);
const t = (...ps: string[]) => ps.map((x) => x + NL).join('');

function pair(text: string) {
  const qa: Uint8Array[] = [];
  const qb: Uint8Array[] = [];
  const a = SyncBridge.create(text, { peer: 1, batchMs: null, onUpdate: (u) => qb.push(u) });
  const b = SyncBridge.fromSnapshot(a.snapshot(), { peer: 2, batchMs: null, onUpdate: (u) => qa.push(u) });
  const settle = () => {
    for (let r = 0; r < 2; r++) {
      a.flush();
      b.flush();
      for (const u of qb.splice(0)) b.receive(u);
      for (const u of qa.splice(0)) a.receive(u);
      a.flush();
      b.flush();
    }
  };
  return { a, b, settle };
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

describe('shared positions', () => {
  it('round-trips every caret offset, including emoji and virtual paragraph marks', () => {
    const { a, b, settle } = pair(t('😀가', '나다', 'ab').slice(0, -1));
    // 문단 이동·삭제로 구획을 여러 개 만든다
    a.doc.moveParagraphs(2, 2, 0);
    a.doc.hideParagraphs(1, 1);
    settle();
    for (const side of [a, b]) {
      for (let o = 0; o <= side.doc.maxCaret; o++) {
        expect(side.resolveCursor(side.cursorAt(o))).toBe(o);
      }
    }
    // 다른 피어의 커서도 같은 자리
    for (let o = 0; o <= a.doc.maxCaret; o++) expect(b.resolveCursor(a.cursorAt(o))).toBe(o);
  });

  it('follows concurrent edits and paragraph moves', () => {
    const { a, b, settle } = pair(t('가나다', '라마바', '사아').slice(0, -1));
    const c = a.cursorAt(5); // 마 앞
    b.doc.insertText(0, 'XY'); // 앞에 입력
    b.doc.insertText(7, 'Z'); // 같은 자리(마 앞)에 입력 → 커서는 마에 붙어 있으므로 Z 뒤
    settle();
    expect(a.doc.text()).toBe(t('XY가나다', '라Z마바', '사아'));
    expect(a.resolveCursor(c)).toBe(a.doc.text().indexOf('마'));
    b.doc.moveParagraphs(1, 1, 3); // 마가 있는 문단을 끝으로
    settle();
    expect(a.doc.text()).toBe(t('XY가나다', '사아', '라Z마바'));
    expect(a.resolveCursor(c)).toBe(a.doc.text().indexOf('마'));
    expect(b.resolveCursor(c)).toBe(b.doc.text().indexOf('마'));
  });

  it('keeps a position whose character was deleted or hidden at the nearest place', () => {
    const { a, b, settle } = pair(t('가나다', '라마바', '사아').slice(0, -1));
    const c = a.cursorAt(5); // 마 앞
    b.doc.deleteRange(5, 6); // 마 삭제
    settle();
    expect(a.resolveCursor(c)).toBe(5); // 바 앞
    b.doc.hideParagraphs(1, 1);
    settle();
    expect(a.doc.text()).toBe(t('가나다', '사아'));
    expect(a.resolveCursor(c)).toBe(4); // 숨긴 문단이 있던 자리 = 사 앞
  });

  it('returns null for a position the peer has not received yet', () => {
    const { a, b } = pair('가나다');
    a.doc.insertText(1, '새 글자');
    const c = a.cursorAt(2);
    expect(b.resolveCursor(c)).toBeNull();
    expect(b.resolveCursor(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('keeps an annotation range on its text across edits (range = two cursors)', () => {
    const { a, b, settle } = pair('오늘은 맑은 날씨입니다');
    const text = a.doc.text();
    const from = text.indexOf('맑은');
    const range = [a.cursorAt(from), a.cursorAt(from + 2)] as const;
    b.doc.insertText(0, '아마도 ');
    b.doc.insertText(b.doc.text().indexOf('날씨'), '좋은 ');
    settle();
    const [f, to] = range.map((r) => a.resolveCursor(r)!) as [number, number];
    expect(a.doc.slice(f, to)).toBe('맑은');
  });
});

describe('per-user undo', () => {
  it('undoes only this peer’s own edits, leaving concurrent remote edits in place', () => {
    const { a, b, settle } = pair('가나다');
    const h = new History(0);
    const s = { anchor: a.doc.positionAt(0), head: a.doc.positionAt(0) };
    h.record({ ops: [{ type: 'insert', ids: a.doc.insertText(1, 'A') }], before: s, after: s, time: 0 });
    b.doc.insertText(2, 'B'); // 다 앞 (A가 입력한 자리와 다른 곳)
    settle();
    expect(a.doc.text()).toBe('가A나B다' + NL);
    h.undo(a.doc);
    settle();
    expect(a.doc.text()).toBe('가나B다' + NL);
    expect(b.doc.text()).toBe(a.doc.text());
    h.redo(a.doc);
    settle();
    expect(b.doc.text()).toBe('가A나B다' + NL);
  });
});

describe('Presence', () => {
  function presencePair(text: string) {
    const p = pair(text);
    const toA: Uint8Array[] = [];
    const toB: Uint8Array[] = [];
    let changesA = 0;
    const pa = new Presence(p.a, { user: { name: 'A', color: '#3366ff' }, onUpdate: (u) => toB.push(u) });
    const pb = new Presence(p.b, {
      user: { name: 'B', color: '#ff6633' },
      onUpdate: (u) => toA.push(u),
      onChange: () => changesA++,
    });
    cleanup.push(() => {
      pa.destroy();
      pb.destroy();
    });
    const deliver = () => {
      for (const u of toB.splice(0)) pb.receive(u);
      for (const u of toA.splice(0)) pa.receive(u);
    };
    return { ...p, pa, pb, toA, toB, deliver, changes: () => changesA };
  }

  it('shares selections and maps them through later edits', () => {
    const { a, b, pa, pb, deliver, settle, changes } = presencePair('가나다라마');
    pa.setSelection(1, 3);
    deliver();
    expect(changes()).toBe(1);
    expect(pb.remotes()).toEqual([{ key: '1', name: 'A', color: '#3366ff', anchor: 1, head: 3 }]);
    // B가 앞에 입력하면 A의 선택은 B 화면에서 뒤로 밀린다 (B의 로컬 편집, 전송 전)
    b.doc.insertText(0, 'XX');
    expect(pb.remotes()[0]).toMatchObject({ anchor: 3, head: 5 });
    settle();
    expect(a.doc.slice(3, 5)).toBe('나다');
    expect(pa.remotes()).toEqual([]);
  });

  it('holds a caret update until the document update that it points into has been sent', () => {
    const { a, pa, pb, toB, deliver, settle } = presencePair('가나다');
    a.doc.insertText(3, '라');
    pa.setSelection(4, 4); // 방금 입력한 글자 뒤 (끝 ¶ 앞)
    expect(toB.length).toBe(0); // 아직 문서 업데이트를 내보내지 않았으므로 보류
    a.flush(); // 문서 업데이트를 내보낸 뒤 프레즌스가 나간다
    expect(toB.length).toBe(1);
    settle();
    deliver();
    expect(pb.remotes()).toMatchObject([{ anchor: 4, head: 4 }]);
  });

  it('falls back to the last resolved place when a position cannot be resolved yet', () => {
    const { a, b, pa, pb, deliver, settle } = presencePair('가나다');
    pa.setSelection(2, 2);
    deliver();
    expect(pb.remotes()).toMatchObject([{ anchor: 2 }]);
    // 문서 업데이트보다 프레즌스가 먼저 도착하는 경우(다른 경로)를 흉내 낸다
    a.doc.insertText(0, '앞');
    a.flush(); // 문서 업데이트는 B의 대기열에 있지만 아직 전달하지 않음
    pa.setSelection(1, 1); // '앞' 뒤 = 가 앞. 가에 붙는 커서라 풀 수 있다
    const stale = a.cursorAt(0); // '앞' 앞: 새 글자에 붙음
    expect(b.resolveCursor(stale)).toBeNull();
    deliver();
    expect(pb.remotes()).toMatchObject([{ anchor: 0 }]);
    settle();
    expect(pb.remotes()).toMatchObject([{ anchor: 1 }]);
  });

  it('applies rapid successive updates in order (same millisecond)', () => {
    const { pa, pb, toB, deliver } = presencePair('가나다라마');
    for (let o = 0; o <= 4; o++) pa.setSelection(o, o);
    deliver();
    expect(pb.remotes()).toMatchObject([{ anchor: 4, head: 4 }]);
    // 늦게 도착한 옛 상태는 버린다
    pa.setSelection(1, 1);
    pa.setSelection(2, 2);
    const [older, newer] = toB.splice(0) as [Uint8Array, Uint8Array];
    pb.receive(newer);
    pb.receive(older);
    expect(pb.remotes()).toMatchObject([{ anchor: 2, head: 2 }]);
  });

  it('expires a silent peer and keeps itself alive with heartbeats', () => {
    vi.useFakeTimers();
    try {
      const { pa, pb, deliver } = presencePair('가나다');
      pa.setSelection(1, 1);
      deliver();
      expect(pb.remotes().length).toBe(1);
      // A가 하트비트를 보내는 동안은 남아 있다
      for (let k = 0; k < 4; k++) {
        vi.advanceTimersByTime(15000);
        deliver();
      }
      expect(pb.remotes().length).toBe(1);
      // A의 소식이 끊기면 (전달하지 않음) 시간 초과로 사라진다
      vi.advanceTimersByTime(46000);
      expect(pb.remotes()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a peer that leaves', () => {
    const { pa, pb, deliver } = presencePair('가나다');
    pa.setSelection(1, 1);
    deliver();
    expect(pb.remotes().length).toBe(1);
    pa.destroy();
    deliver();
    expect(pb.remotes()).toEqual([]);
  });
});
