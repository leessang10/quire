/**
 * Word가 다시 저장한 DOCX (15 §6.3, 사람·도구 확인): 주요 요소 문서를 내보내 Word로 열어 다시 저장한 파일을 읽으면 DOCX 열의
 * 요소가 원본과 같다. Word가 있는 기기에서만 돈다:
 *   QUIRE_DOCX_OUT=a.docx로 내보내고 → Word로 열어 b.docx로 저장 → QUIRE_WORD_RESAVED=b.docx
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetIdOf } from '@quiredoc/sync';
import { SUPPORT, elementsDocument, firstDifference, importDocx, project } from './index';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGNgYGD4z8DAAAAEAwEAmEtrpQAAAABJRU5ErkJggg==';
const resaved = process.env.QUIRE_WORD_RESAVED;

describe('DOCX resaved by Word', () => {
  it.skipIf(!resaved)('keeps the DOCX column of the major elements', async () => {
    const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
    const asset = await assetIdOf(bytes);
    const q = elementsDocument({ asset, w: 96 * 750, h: 48 * 750 });
    const r = await importDocx(new Uint8Array(readFileSync(resaved!)));
    expect(firstDifference(project(q, SUPPORT.docx), project(r.doc, SUPPORT.docx))).toBeNull();
    expect([...r.assets.keys()]).toEqual([asset]);
  });
});
