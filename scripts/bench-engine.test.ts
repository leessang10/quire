/**
 * 엔진 벤치마크 (DOM 없음): 모델 + 레이아웃의 키 입력당 비용
 *   npm run bench
 *
 * 에디터가 키 입력 1회에 하는 일을 그대로 흉내 낸다:
 * 편집 → 문단 목록 → 증분 레이아웃(캐럿 아래 두 화면까지 즉시) → 캐럿 위치 계산 (+ 선택 위치 해석)
 * 나머지 쪽 조립은 입력 사이 유휴 시간에 8ms 조각으로 진행된다고 가정하고 측정에서 뺀다.
 * 글자 폭은 고정값(한글 16, 그 외 8)이므로 실제 브라우저의 measureText 비용은 포함되지 않는다.
 */
import { it } from 'vitest';
import { Doc } from '@quire/model';
import { PLAIN_STYLE, PagedLayout, type Measurer, type PageSetup, type RunStyle } from '@quire/layout';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const setup: PageSetup = { width: 794, height: 1123, margin: 96, gap: 24, lineHeight: 27, paraSpacing: 8 };
const VIEW = 900; // 화면 높이 가정
const NL = String.fromCharCode(10);

const LOREM =
  '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. 이 문단은 대형 문서 성능 측정을 위해 반복해서 생성된 문단입니다. 레이아웃 캐시가 동작하면 편집할 때 바뀐 문단만 다시 줄을 나눕니다.';

function makeDoc(paragraphs: number): Doc {
  const ps: string[] = [];
  for (let i = 0; i < paragraphs; i++) ps.push(`${i + 1}. ${LOREM}`);
  return Doc.fromText(ps.join(NL));
}

function stats(t: number[]) {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
  return `p50 ${q(0.5).padStart(7)}  p95 ${q(0.95).padStart(7)}  max ${q(1).padStart(7)} ms`;
}

/**
 * 서식 많은 문서 (10 §6): 문단마다 굵게·크기·기울임·색 구간 4개 (어절 경계와 어긋나게). 편집기와 같은 규칙으로 서식 → 영향
 */
function formatDoc(doc: Doc): (id: number) => RunStyle {
  for (const p of [...doc.paragraphs()].reverse()) {
    const a = p.start;
    doc.format(a + 3, a + 9, 'bold', true);
    doc.format(a + 20, a + 31, 'size', 18000);
    doc.format(a + 40, a + 52, 'italic', true);
    doc.format(a + 60, a + 66, 'color', '#c01c28');
  }
  doc.takeParagraphChanges(); // 준비 단계의 변경 기록은 레이아웃이 생기기 전 것
  const cache: RunStyle[] = [];
  return (id) => {
    if (cache[id]) return cache[id]!;
    const m = doc.markSet(id);
    const base = m.size ? (m.size / 1000) * (96 / 72) / 16 : 1;
    return (cache[id] = id === 0 ? PLAIN_STYLE : { face: m.bold ? 1 : 0, scale: base, line: base });
  };
}

/**
 * moves > 0이면 측정 전에 문단 이동 moves번 + 문단 삭제(숨김) moves/5번을 해서 구획을 만든다.
 * formatted면 서식 많은 문서에서, 서식 구간 안(굵게)에 입력한다.
 */
function scenario(paragraphs: number, where: number, moves = 0, formatted = false) {
  const doc = makeDoc(paragraphs);
  const style = formatted ? formatDoc(doc) : null;
  let t = performance.now();
  const layout = new PagedLayout(setup, measurer, undefined, style);
  layout.update(doc.paragraphs(), null, VIEW * 2);
  const firstScreen = performance.now() - t;
  t = performance.now();
  let slices = 0;
  while (layout.step(8)) slices++;
  const background = performance.now() - t;

  const moveMs: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
  for (let k = 0; k < moves; k++) {
    const n = doc.paragraphs().length;
    const i = Math.floor(rnd() * n);
    const s = performance.now();
    doc.moveParagraphs(i, i, Math.floor(rnd() * (n + 1)));
    layout.update(doc.paragraphs(), null, VIEW * 2, doc.takeParagraphChanges());
    moveMs.push(performance.now() - s);
    layout.step(8);
    if (k % 5 === 4) {
      const h = Math.floor(rnd() * (n - 1));
      doc.hideParagraphs(h, h);
      layout.update(doc.paragraphs(), null, VIEW * 2, doc.takeParagraphChanges());
    }
  }

  let caret = Math.floor(doc.length * where);
  if (formatted) caret = doc.paragraphs()[doc.paragraphIndexAt(caret)]!.start + 5; // 굵게 구간 안
  let caretY = layout.caretRect(caret).y;
  const step = (edit: () => void) => {
    const s = performance.now();
    edit();
    layout.update(doc.paragraphs(), null, caretY + VIEW * 2, doc.takeParagraphChanges());
    const pos = doc.positionAt(caret);
    caretY = layout.caretRect(doc.resolve(pos)).y;
    doc.resolve(pos);
    const ms = performance.now() - s;
    // 다음 입력 전 유휴 시간에 백그라운드 조각 하나 진행 (측정 제외)
    layout.step(8);
    return ms;
  };

  const typing: number[] = [];
  for (let i = 0; i < 300; i++) {
    typing.push(step(() => doc.insertText(caret++, '가')));
  }
  const enter: number[] = [];
  for (let i = 0; i < 50; i++) {
    enter.push(step(() => doc.insertText(caret++, NL)));
  }
  const back: number[] = [];
  for (let i = 0; i < 100; i++) {
    back.push(step(() => doc.deleteRange(--caret, caret + 1)));
  }

  layout.finish();
  const mem = process.memoryUsage().heapUsed / 1e6;
  console.log(
    [
      '',
      `■ ${paragraphs.toLocaleString()} 문단 / ${layout.pageCount} 쪽 / 캐럿 위치 ${Math.round(where * 100)}%  (heap ${mem.toFixed(0)} MB)` +
        (moves ? ` / 이동 ${moves}회 후 구획 ${doc.segmentCount}개` : '') +
        (formatted ? ' / 서식 많음' : ''),
      ...(moves ? [`  문단 이동          ${stats(moveMs)}`] : []),
      `  첫 화면 배치       ${firstScreen.toFixed(1)} ms   (나머지 백그라운드 ${background.toFixed(0)} ms, 8ms 조각 ${slices}개)`,
      `  글자 입력          ${stats(typing)}`,
      `  Enter              ${stats(enter)}`,
      `  Backspace          ${stats(back)}`,
    ].join(NL),
  );
}

it('engine benchmark', () => {
  scenario(1_000, 0.5); // 워밍업 겸 약 100쪽
  scenario(10_000, 0.5); // 약 1,000쪽
  scenario(10_000, 0.001);
  scenario(100_000, 0.5); // 06 §2 V5 기준 (10만 문단)
  scenario(100_000, 0.001);
  // 구획이 여러 개인 문서 (문단 이동·삭제 후)
  scenario(10_000, 0.5, 50);
  scenario(100_000, 0.5, 50);
  // 서식 많은 문서 (10 §6: 입력 p95 16 ms 이하)
  scenario(10_000, 0.5, 0, true);
  scenario(100_000, 0.5, 0, true);
}, 600_000);
