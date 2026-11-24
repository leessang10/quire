/**
 * .quire 파일의 협업 이력 (07 §2–3, 19 §4.1): history/crdt.bin = Loro 스냅샷. 파일 읽기·쓰기 자체는 `@quiredoc/model`
 * (`packQuire`·`openQuire`)이고, 여기서는 Loro가 필요한 일만 한다: 이력을 만들어 넣기, 연 이력을 확인하고 되살리기.
 */
import type { LoroDoc } from 'loro-crdt';
import { Doc, documentFromQuire, packQuire, quireFromDocument, stateHash, type OpenedQuire, type QuireAsset } from '@quiredoc/model';
import { documentFromLoro, newLoro, readRaw, readState } from './shape';

/** Loro 문서의 화면 텍스트 (Doc.fromRaw로 화면 순서·숨김을 적용한 결과) */
export function displayText(loro: LoroDoc): string {
  const { raw, keys } = readRaw(loro);
  if (raw.length === 0) return '';
  return Doc.fromRaw(raw, keys, readState(loro)).text();
}

/** 저장: Loro 문서의 화면 상태로 document.json을, 그 스냅샷으로 history/crdt.bin을 만든다 */
export function packQuireWithHistory(src: { loro: LoroDoc; assets?: readonly QuireAsset[] }): Promise<Uint8Array<ArrayBuffer>> {
  return packQuire({ document: documentFromLoro(src.loro), assets: src.assets, history: src.loro.export({ mode: 'snapshot' }) });
}

/**
 * 연 파일의 이력을 쓸 수 있으면 그 CRDT 스냅샷, 아니면 null. 이력의 화면 상태 정본 해시가 document.json과 같아야 한다
 * (외부 도구가 JSON만 고쳤으면 다르다: 이력을 버리고 document.json에서 새로 만든다). 버린 까닭은 `opened.notes`에 더한다
 */
export async function restoreHistory(opened: OpenedQuire): Promise<Uint8Array | null> {
  const crdt = opened.history;
  if (!crdt) return null;
  // 정본을 다시 정규화해 비교한다 (손으로 고친 JSON의 공백·키 순서 차이는 무시)
  const want = await stateHash(quireFromDocument(documentFromQuire(opened.doc).document));
  let have: string | null = null;
  try {
    const loro = newLoro(1);
    loro.import(crdt);
    have = await stateHash(quireFromDocument(documentFromLoro(loro)));
  } catch (e) {
    opened.notes.push(`history/crdt.bin: cannot be read (${String(e)})`);
  }
  if (have !== want) {
    if (have !== null) opened.notes.push('history/crdt.bin: state differs from document.json; history dropped');
    return null;
  }
  return crdt;
}
