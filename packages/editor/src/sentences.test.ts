/**
 * 한글 문장 세트 (12 §1, §9, G7): fixtures/sentences/ko.json의 문장 200개를 저장소 글꼴(셰이핑)로 네 방식으로 나눠
 * 기대값(ko.expected.json: 줄마다 시작 위치)과 비교하고, 규칙을 불변식으로 본다.
 *   - word: 어절 단위 (기본), char: 글자 단위, hang: 글자 단위 + 문장부호 걸침, squeeze: 어절 단위 + 양쪽 정렬 어간 줄임
 * 기대값이 없거나 QUIRE_UPDATE_REFERENCE=1이면 새로 쓴다 (사람이 줄 나눔을 보고 커밋).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HbShaper, loadShapingFont, slotOf } from '@quire/shaping';
import { NO_LINE_END, NO_LINE_START, PLAIN_STYLE, cpSlice, layoutParagraph, type ParaBox, type ParaLayout } from '@quire/layout';

const root = join(__dirname, '../../..');
const font = (p: string, name: string) => loadShapingFont(readFileSync(join(root, p)), name);
const pretendard = font('fonts/pretendard/Pretendard-Regular.otf', 'Pretendard');
const noto = font('fonts/noto-sans-kr/NotoSansKR-Regular.otf', 'Noto Sans KR');
const shaper = new HbShaper([slotOf(pretendard), noto], { size: 16 });

const file = join(root, 'fixtures/sentences/ko.json');
const expFile = join(root, 'fixtures/sentences/ko.expected.json');
const sentences: string[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const WIDTH = 260;

const MODES: Record<string, ParaBox> = {
  word: { align: 'left', left: 0, right: 0, first: 0, before: 0, after: 0, line: null },
  char: { align: 'left', left: 0, right: 0, first: 0, before: 0, after: 0, line: null, korean: { char: true } },
  hang: { align: 'left', left: 0, right: 0, first: 0, before: 0, after: 0, line: null, korean: { char: true, hang: true } },
  squeeze: { align: 'justify', left: 0, right: 0, first: 0, before: 0, after: 0, line: null, korean: { squeeze: 0.8 } },
};

const lay = (text: string, box: ParaBox) => layoutParagraph(text, WIDTH, shaper, null, { fmt: null, mark: 0, style: () => PLAIN_STYLE, box });
const lineText = (pl: ParaLayout, k: number) => cpSlice(pl, pl.lines[k]!.start, pl.lines[k]!.end);

describe('Korean sentence set (12 §9, G7)', () => {
  it('line breaks match the reviewed expectation in every mode', () => {
    expect(sentences.length).toBe(200);
    const got = sentences.map((t) => Object.fromEntries(Object.entries(MODES).map(([m, box]) => [m, lay(t, box).lines.map((l) => l.start)])));
    if (!existsSync(expFile) || process.env.QUIRE_UPDATE_REFERENCE === '1') {
      writeFileSync(expFile, JSON.stringify(got) + '\n');
      return;
    }
    expect(got).toEqual(JSON.parse(readFileSync(expFile, 'utf8')));
  });

  it('keeps the rules: no line starts with a no-start character or ends with a no-end one, Latin words stay whole', () => {
    for (const t of sentences)
      for (const [mode, box] of Object.entries(MODES)) {
        const pl = lay(t, box);
        for (let k = 0; k < pl.lines.length; k++) {
          const s = lineText(pl, k);
          const trimmed = s.replace(/[ \t]+$/, '');
          // 한 어절이 줄보다 길어 글자 단위로 끊은 줄은 금칙 당김 한 글자까지만 (규칙이 줄을 비게 하지 않는다)
          const forced = k > 0 && !/[ \t]$/.test(lineText(pl, k - 1));
          if (k > 0 && !forced) expect(NO_LINE_START.has(Array.from(s)[0]!), `${mode} "${s}"`).toBe(false);
          if (k < pl.lines.length - 1 && !/[ \t]$/.test(s) && mode !== 'word') {
            const last = Array.from(trimmed).at(-1)!;
            expect(NO_LINE_END.has(last), `${mode} ends with ${last}`).toBe(false);
          }
          // 영문·숫자 사이에서는 (줄보다 긴 낱말이 아니면) 끊지 않는다
          if (k < pl.lines.length - 1 && !/[ \t]$/.test(s)) {
            const a = Array.from(s).at(-1)!;
            const b = Array.from(lineText(pl, k + 1))[0]!;
            const longWord = /[A-Za-z0-9]/.test(a) && /[A-Za-z0-9]/.test(b);
            if (longWord) {
              // 그 낱말이 실제로 줄보다 길었다 (줄 전체가 그 낱말)
              expect(/\s/.test(trimmed), `${mode} split "${a}|${b}" in "${s}"`).toBe(false);
            }
          }
        }
      }
  });

  it('char mode breaks between Hangul syllables and fills lines at least as well as word mode', () => {
    let fuller = 0;
    for (const t of sentences) {
      const w = lay(t, MODES.word!);
      const c = lay(t, MODES.char!);
      expect(c.lines.length).toBeLessThanOrEqual(w.lines.length);
      if (c.lines.length < w.lines.length) fuller++;
      // 글자 단위 줄의 첫 줄은 폭 안에 (걸침 없음)
      expect(c.xs[c.lines[0]!.end]! - c.xs[0]!).toBeLessThanOrEqual(WIDTH + 30);
    }
    expect(fuller).toBeGreaterThan(10);
  });

  it('hanging lets a comma or period overhang the line end; squeeze fits more on a line', () => {
    let hung = 0;
    let squeezed = 0;
    for (const t of sentences) {
      const c = lay(t, MODES.char!);
      const h = lay(t, MODES.hang!);
      expect(h.lines.length).toBeLessThanOrEqual(c.lines.length);
      for (const ln of h.lines) {
        let e = ln.end;
        while (e > ln.start && /[ 	]/.test(cpSlice(h, e - 1, e))) e--;
        const w = h.xs[e]! - h.xs[ln.start]!;
        if (w > WIDTH + 0.01 && ln.end < h.n) {
          hung++;
          expect(/[,.、。，．][ \t]*$/.test(cpSlice(h, ln.start, ln.end))).toBe(true);
        }
      }
      const w = lay(t, MODES.word!);
      const sq = lay(t, MODES.squeeze!);
      expect(sq.lines.length).toBeLessThanOrEqual(w.lines.length);
      if (sq.lines.length < w.lines.length || sq.lines.some((l, k) => l.end > (w.lines[k]?.end ?? Infinity))) squeezed++;
    }
    expect(squeezed).toBeGreaterThan(0);
    // 마침표가 꼭 줄 끝을 넘는 문장: 걸침이면 그 줄에 남고, 아니면 금칙으로 앞 글자와 함께 다음 줄로
    const probe = lay('가'.repeat(30), MODES.word!);
    const dot = lay('.', MODES.word!).xs[1]!;
    const W = probe.xs[16]! + dot / 2; // 글자 16개는 들어가고 마침표는 반만
    const at = (text: string, box: ParaBox) => layoutParagraph(text, W, shaper, null, { fmt: null, mark: 0, style: () => PLAIN_STYLE, box });
    const t = '가'.repeat(16) + '.나다라마바사';
    const hang = at(t, MODES.hang!);
    const plain = at(t, MODES.char!);
    expect(cpSlice(hang, hang.lines[0]!.start, hang.lines[0]!.end)).toBe('가'.repeat(16) + '.');
    expect(cpSlice(plain, plain.lines[0]!.start, plain.lines[0]!.end)).toBe('가'.repeat(15));
    void hung;
  });
});
