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
import { PagedLayout, type Measurer, type PageSetup } from '@quire/layout';

const measurer: Measurer = { width: (g) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) };
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

function scenario(paragraphs: number, where: number) {
  const doc = makeDoc(paragraphs);
  let t = performance.now();
  const layout = new PagedLayout(setup, measurer);
  layout.update(doc.paragraphs(), null, VIEW * 2);
  const firstScreen = performance.now() - t;
  t = performance.now();
  let slices = 0;
  while (layout.step(8)) slices++;
  const background = performance.now() - t;

  let caret = Math.floor(doc.length * where);
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
      `■ ${paragraphs.toLocaleString()} 문단 / ${layout.pageCount} 쪽 / 캐럿 위치 ${Math.round(where * 100)}%  (heap ${mem.toFixed(0)} MB)`,
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
}, 600_000);
