/**
 * 줄 나눔 회귀 시험 (02 R1 결정성). 저장소 글꼴(Pretendard + Noto Sans KR)로 고정 말뭉치를 조판해 줄 나눔과 x 위치의 지문을
 * 고정해 둔다. 같은 글꼴 파일·같은 HarfBuzz·같은 엔진 코드면 어느 기기·브라우저·Node에서도 같아야 한다.
 *
 * 지문이 바뀌면: 글꼴·harfbuzzjs·셰이퍼·레이아웃을 일부러 바꾼 경우에만 새 값으로 고친다 (쪽 나눔이 바뀌는 변경이다).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boxFingerprint as boxFp, fingerprint as fp } from './fingerprint';
import { loadShapingFont } from './shaper';

const root = join(__dirname, '../../..');
const pretendard = loadShapingFont(readFileSync(join(root, 'fonts/pretendard/Pretendard-Regular.otf')), 'Pretendard');
const pretendardBold = loadShapingFont(readFileSync(join(root, 'fonts/pretendard/Pretendard-Bold.otf')), 'Pretendard Bold');
const noto = loadShapingFont(readFileSync(join(root, 'fonts/noto-sans-kr/NotoSansKR-Regular.otf')), 'Noto Sans KR');
const fonts = { pretendard, pretendardBold, noto };
const fingerprint = (formatted = false) => fp(fonts, formatted);
const boxFingerprint = (floats = false) => boxFp(fonts, floats);

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

  it('places floats and wraps text around them the same way (11 §4.2)', () => {
    const a = boxFingerprint(true);
    expect(boxFingerprint(true)).toBe(a);
    expect(a).toBe(EXPECTED_FLOATS);
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

/** 2026-11-18: 위 + 떠 있는 개체와 어울림 (11 §4.2, 2-9) */
const EXPECTED_FLOATS = '6403735d';
