/**
 * 각주 (12 §6.1). 참조는 본문의 인라인 개체 { kind: 'note', id }이고, 내용은 가벼운 스토리 fn|<참조 개체 id>다 (셀처럼 ID에서
 * 정해진다: 두 피어가 동시에 처음 열어도 한 스토리). 번호는 저장하지 않는다: 본문의 참조 순서로 1, 2, 3 … (목록 번호처럼 파생 값).
 * 참조를 지워도 각주 스토리는 남는다 (되돌리면 그대로). 정본에는 쓰이는 각주만 저장한다.
 */
import type { Doc } from './doc';

/** 각주 스토리 ID */
export function noteStoryId(id: string): string {
  return `fn|${id}`;
}

export function isNoteStory(story: string): boolean {
  return story.startsWith('fn|');
}

/** 본문의 각주 참조 (문서 순서): 문단 번호, 문단 안 위치, 개체 id */
export interface NoteRefAt {
  para: number;
  k: number;
  id: string;
}

/**
 * 본문의 각주 참조들 (문서 순서). 각주를 넣은 적이 없는 문서는 훑지 않는다. 문단 수에 비례한다 (개체 속성 표에서 개체마다 화면
 * 오프셋을 구하는 쪽이 문단 10만 개에서도 더 느렸다)
 */
export function noteRefs(doc: Doc): NoteRefAt[] {
  const out: NoteRefAt[] = [];
  if (!doc.hasObjectKind('note')) return out;
  const paras = doc.paragraphs();
  for (let i = 0; i < paras.length; i++) {
    const objs = paras[i]!.objs;
    if (!objs) continue;
    const ks = objs.size === 1 ? [...objs.keys()] : [...objs.keys()].sort((a, b) => a - b);
    for (const k of ks) {
      const o = objs.get(k)!;
      if (o.kind === 'note' && o.id) out.push({ para: i, k, id: o.id });
    }
  }
  return out;
}
