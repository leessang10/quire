/**
 * 기준 문서 세트 (12 §1): fixtures/docs/*.json을 저장소 글꼴로 편집기와 같은 서식(Formatter)으로 조판해, 쪽 수·쪽마다 첫 줄·
 * 레이아웃 지문을 기대값(*.expected.json)과 비교한다. 3단계의 완료 판단은 이 기대값이다.
 *
 * 기대값이 없거나 QUIRE_UPDATE_REFERENCE=1이면 새로 쓴다. 바뀐 기대값은 사람이 쪽 첫 줄을 보고 확인한 뒤 커밋한다
 * (쪽 나눔이 바뀌는 변경이다).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentFromQuire, migrateQuire } from '@quiredoc/sync';
import { HbShaper, loadShapingFont, slotOf } from '@quiredoc/shaping';
import type { Document } from '@quiredoc/model';
import { composeReference, summarizeLayout } from './reference';

const root = join(__dirname, '../../..');
const dir = join(root, 'fixtures/docs');
const font = (p: string, name: string) => loadShapingFont(readFileSync(join(root, p)), name);
const pretendard = font('fonts/pretendard/Pretendard-Regular.otf', 'Pretendard');
const pretendardBold = font('fonts/pretendard/Pretendard-Bold.otf', 'Pretendard Bold');
const noto = font('fonts/noto-sans-kr/NotoSansKR-Regular.otf', 'Noto Sans KR');
const shaper = new HbShaper([{ ...slotOf(pretendard), bold: slotOf(pretendardBold) }, noto], { size: 16 });

/** 편집기와 같게 조판 (A4, 16px, 셰이핑) */
const compose = (document: Document) => composeReference(document, shaper, pretendard.metrics);
const summarize = (document: Document, c: ReturnType<typeof compose>) => summarizeLayout(document, c.layout, c.fmt);

const open = (name: string) => documentFromQuire(migrateQuire(JSON.parse(readFileSync(join(dir, name), 'utf8'))).doc).document;
const docs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json')) : [];

describe('reference documents (12 §1)', () => {
  for (const name of docs) {
    it(`${name}: pages and page starts match the reviewed expectation`, () => {
      const document = open(name);
      const got = summarize(document, compose(document));
      const file = join(dir, name.replace(/\.json$/, '.expected.json'));
      if (!existsSync(file) || process.env.QUIRE_UPDATE_REFERENCE === '1') {
        writeFileSync(file, JSON.stringify(got, null, 2) + '\n');
        console.log(`기대값을 썼다: ${file} (쪽 ${got.pages})`);
        return;
      }
      expect(got).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    });

    it(`${name}: incremental relayout after edits equals a fresh layout`, () => {
      const document = open(name);
      const c = compose(document);
      const body = document.body;
      // 가운데 문단에 긴 글 넣기 → 쪽 나눔이 밀린다, 그다음 지우기
      const mid = body.paragraphs()[Math.floor(body.paragraphs().length / 2)]!;
      const add = ' 덧붙인 글입니다.'.repeat(20);
      body.insertText(mid.end, add);
      c.layout.update(body.paragraphs(), null, Infinity, body.takeParagraphChanges());
      c.layout.finish();
      const inc = summarize(document, c);
      const fresh = summarize(document, compose(document));
      expect(inc).toEqual(fresh);
      body.deleteRange(mid.end, mid.end + Array.from(add).length);
      c.layout.update(body.paragraphs(), null, Infinity, body.takeParagraphChanges());
      c.layout.finish();
      expect(summarize(document, c)).toEqual(summarize(document, compose(document)));
    });
  }
});
