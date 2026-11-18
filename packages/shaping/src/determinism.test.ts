/**
 * 줄 나눔 회귀 시험 (02 R1 결정성). 저장소 글꼴(Pretendard + Noto Sans KR)로 고정 말뭉치를 조판해 줄 나눔과 x 위치의 지문을
 * 고정해 둔다. 같은 글꼴 파일·같은 HarfBuzz·같은 엔진 코드면 어느 기기·브라우저·Node에서도 같아야 한다.
 *
 * 지문이 바뀌면: 글꼴·harfbuzzjs·셰이퍼·레이아웃을 일부러 바꾼 경우에만 새 값으로 고친다 (쪽 나눔이 바뀌는 변경이다).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LayoutCache, PLAIN_STYLE, PagedLayout, layoutParagraph, lineX, type ParaBox, type ParaFormat, type RunStyle } from '@quire/layout';
import { HbShaper, loadShapingFont, slotOf } from './shaper';

const root = join(__dirname, '../../..');
const pretendard = loadShapingFont(readFileSync(join(root, 'fonts/pretendard/Pretendard-Regular.otf')), 'Pretendard');
const pretendardBold = loadShapingFont(readFileSync(join(root, 'fonts/pretendard/Pretendard-Bold.otf')), 'Pretendard Bold');
const noto = loadShapingFont(readFileSync(join(root, 'fonts/noto-sans-kr/NotoSansKR-Regular.otf')), 'Noto Sans KR');

const CORPUS = [
  '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다.',
  '줄바꿈은 어절 단위입니다. 아주긴단어가한줄보다길어지면글자단위로끊기는데이때마침표나쉼표같은닫는문장부호는줄의맨앞에오지않도록합니다.',
  'Quire는 canvas에 직접 그린다. AVATAR Wave To. office affluent "따옴표" (괄호) — 1,234.5%',
  '大韓民國 憲法 第一條 ① 대한민국은 民主共和國이다. ᄒᆞᆫ글 옛한글도 섞는다.',
  '탭\t문자와　전각 공백, 그리고 아주 긴 문단을 여러 번 되풀이한다. '.repeat(12),
];
const WIDTHS = [602, 400, 250];

/**
 * 서식 (10 §4, 2-3): 편집기와 같은 규칙의 서식 번호 → 영향. 1 굵게, 2 18pt(16px 기준 1.5배), 3 위 첨자, 4 굵은 9pt.
 * 글자마다 (코드포인트 번호 × 7 + 어절 번호) mod 5로 서식을 정해 서식 경계가 어절 안팎에 고루 생기게 한다.
 */
const STYLES: RunStyle[] = [
  PLAIN_STYLE,
  { face: 1, scale: 1, line: 1 },
  { face: 0, scale: 24 / 16, line: 24 / 16 },
  { face: 0, scale: 0.65, line: 1 },
  { face: 1, scale: 12 / 16, line: 12 / 16 },
];
function formatOf(text: string): ParaFormat {
  const cps = Array.from(text);
  const fmt = new Uint16Array(cps.length);
  let word = 0;
  cps.forEach((c, k) => {
    if (c === ' ') word++;
    fmt[k] = (k * 7 + word) % 5 === 0 ? (k + word) % 4 + 1 : 0;
  });
  return { fmt, mark: 2, style: (id) => STYLES[id]! };
}

/** 줄 시작 위치와 각 줄 끝 x(float32 비트)의 FNV-1a 지문. formatted면 서식을 걸고 줄 높이 배율도 섞는다 */
function fingerprint(formatted = false): string {
  const shaper = formatted
    ? new HbShaper([{ ...slotOf(pretendard), bold: slotOf(pretendardBold) }, noto], { size: 16 })
    : new HbShaper([pretendard, noto], { size: 16 });
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 16777619);
  };
  const bits = new Uint32Array(1);
  const f32 = new Float32Array(bits.buffer);
  for (const w of WIDTHS)
    for (const text of CORPUS) {
      const pl = layoutParagraph(text, w, shaper, null, formatted ? formatOf(text) : null);
      for (const ln of pl.lines) {
        mix(ln.start);
        mix(ln.end);
        f32[0] = pl.xs[ln.end]! - pl.xs[ln.start]!;
        mix(bits[0]!);
        if (formatted) {
          f32[0] = ln.scale;
          mix(bits[0]!);
        }
      }
    }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 문단 상자 (10 §4, 2-4): 말뭉치 문단마다 돌아가며 건다 (px) */
const BOXES: ParaBox[] = [
  { align: 'justify', left: 0, right: 0, first: 32, before: 8, after: 0, line: null },
  { align: 'center', left: 24, right: 24, first: 0, before: 24, after: 8, line: { rule: 'multiple', value: 1.15 } },
  { align: 'left', left: 48, right: 0, first: -24, before: 8, after: 0, line: { rule: 'multiple', value: 1.5 } },
  { align: 'right', left: 0, right: 16, first: 0, before: 0, after: 4, line: { rule: 'atLeast', value: 30 } },
  { align: 'justify', left: 32, right: 32, first: 0, before: 8, after: 0, line: { rule: 'exact', value: 20 } },
];

/** 쪽 배치 결과(줄마다 쪽·y·높이·x·양쪽 맞춤 끝 x)의 지문. 서식 말뭉치 + 문단 상자 */
function boxFingerprint(): string {
  const shaper = new HbShaper([{ ...slotOf(pretendard), bold: slotOf(pretendardBold) }, noto], { size: 16 });
  const paras = CORPUS.flatMap((t, i) => [0, 1, 2].map((k) => ({ id: `${i}-${k}`, start: 0, text: t, box: BOXES[(i + k) % BOXES.length]! })));
  let start = 0;
  for (const q of paras) {
    q.start = start;
    start += Array.from(q.text).length + 1;
  }
  const setup = { width: 794, height: 1123, margin: 96, gap: 24, lineHeight: 27, paraSpacing: 8, fontSize: 16, ascent: 0.95, descent: 0.24 };
  const layout = new PagedLayout(setup, shaper, new LayoutCache(), (info) => {
    const q = info as (typeof paras)[number];
    return { ...formatOf(q.text), box: q.box };
  });
  layout.update(paras);
  layout.finish();
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 16777619);
  };
  const bits = new Uint32Array(1);
  const f32 = new Float32Array(bits.buffer);
  const mixF = (v: number) => {
    f32[0] = v;
    mix(bits[0]!);
  };
  for (let i = 0; i < paras.length; i++) {
    const pp = layout.para(i);
    for (const ln of pp.lines) {
      mix(ln.start);
      mix(ln.end);
      mix(ln.page);
      mixF(ln.y);
      mixF(ln.height);
      mixF(ln.baseline);
      mixF(ln.x);
      mixF(lineX(pp.layout, ln, ln.end));
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('layout determinism', () => {
  it('breaks the corpus into the same lines at the same positions (fingerprint)', () => {
    const a = fingerprint();
    expect(fingerprint()).toBe(a); // 캐시를 거쳐도 같다
    expect(a).toBe(EXPECTED);
  });

  it('places paragraph boxes the same way (indents, center, right, justify, spacing, line rules)', () => {
    const a = boxFingerprint();
    expect(boxFingerprint()).toBe(a);
    expect(a).toBe(EXPECTED_BOXES);
  });

  it('does the same for a formatted corpus (bold face, sizes, superscript, per-line height)', () => {
    const a = fingerprint(true);
    expect(fingerprint(true)).toBe(a);
    expect(a).toBe(EXPECTED_FORMATTED);
  });
});

/** 2026-11-17: Pretendard v1.3.9 + Noto Sans KR Sans2.004, harfbuzzjs 1.6.4 */
const EXPECTED = '5a769681';

/** 2026-11-18: 위 + Pretendard Bold v1.3.9, 서식 규칙(10 §4) */
const EXPECTED_FORMATTED = 'c23e13e0';

/** 2026-11-18: 위 + 문단 상자 (10 §4, 2-4) */
const EXPECTED_BOXES = '66ba6585';
