/** 시험용: 문서의 서식 상태 (비교용). 문단마다 글·글자별 서식·¶ 서식·속성, 스타일, 목록 정의, 목록 번호 */
import type { Doc } from '@quiredoc/model';

export function formatState(doc: Doc) {
  const ms = (id: number) => JSON.stringify(doc.markSet(id));
  return {
    paras: doc.paragraphs().map((p) => ({
      t: p.text,
      f: Array.from(p.text).map((_, k) => ms(p.fmt ? p.fmt[k]! : 0)),
      m: ms(p.mark),
      a: p.attrs,
      o: p.objs ? [...p.objs] : null,
    })),
    styles: [...doc.styles()].sort((a, b) => (a.name < b.name ? -1 : 1)),
    lists: [...doc.lists()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    labels: doc.paragraphs().map((p) => doc.listLabel(p)?.text ?? null),
    sections: [...doc.sectionDefs()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  };
}

/** 키 순서와 무관한 JSON (비교용) */
export function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
}
