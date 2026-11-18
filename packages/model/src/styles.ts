/**
 * 문단 스타일 (10 §2.3). 문서 설정(07 §4 `styles`)에 저장하는 이름 붙은 문단 속성 + 기본 글자 서식.
 *
 * 실제 서식 = 스타일 사슬(basedOn)의 값 → 문단 직접 속성 → 글자 직접 서식 순으로 덮어쓴 것. 글자 스타일은 아직 없다.
 * 스타일이 없는 문단은 본문(body) 스타일이다.
 */
import type { MarkSet, ParaAttrs } from './doc';

export interface Style {
  name: string;
  /** 사람이 읽는 이름 (UI) */
  label?: string;
  basedOn?: string;
  /** 문단 끝에서 Enter로 만든 다음 문단의 스타일 (없으면 같은 스타일) */
  next?: string;
  para?: ParaAttrs;
  marks?: MarkSet;
}

export const BODY_STYLE = 'body';

/** 크기 1/1000pt */
export const DEFAULT_STYLES: readonly Style[] = Object.freeze([
  { name: 'body', label: '본문' },
  {
    name: 'h1', label: '제목 1', basedOn: 'body', next: 'body',
    para: { space: { before: 18000, after: 6000 }, keepWithNext: true }, marks: { bold: true, size: 24000 },
  },
  {
    name: 'h2', label: '제목 2', basedOn: 'body', next: 'body',
    para: { space: { before: 14000, after: 4000 }, keepWithNext: true }, marks: { bold: true, size: 18000 },
  },
  {
    name: 'h3', label: '제목 3', basedOn: 'body', next: 'body',
    para: { space: { before: 12000, after: 4000 }, keepWithNext: true }, marks: { bold: true, size: 14000 },
  },
  { name: 'quote', label: '인용', basedOn: 'body', para: { indent: { left: 24000, right: 24000 } }, marks: { italic: true, color: '#555555' } },
  { name: 'listParagraph', label: '목록 문단', basedOn: 'body', para: { indent: { left: 24000 } } },
] satisfies Style[]);

/** 스타일 사슬을 풀어 쓴 값 */
export interface ResolvedStyle {
  para: ParaAttrs;
  marks: MarkSet;
  /** 사슬에 든 스타일 이름 (자기 자신부터) */
  chain: readonly string[];
}

/** 문단 속성 두 개를 겹친다 (b가 이김). indent·space는 키별로 겹친다 */
export function mergeParaAttrs(a: ParaAttrs, b: ParaAttrs): ParaAttrs {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if ((k === 'indent' || k === 'space') && v && typeof v === 'object' && out[k] && typeof out[k] === 'object')
      out[k] = { ...(out[k] as object), ...(v as object) };
    else out[k] = v;
  }
  return out as ParaAttrs;
}

/** 이름 → 풀어 쓴 스타일. 없는 이름은 본문으로, 순환은 끊는다 */
export function resolveStyle(name: string, get: (name: string) => Style | undefined): ResolvedStyle {
  const chain: Style[] = [];
  const seen = new Set<string>();
  let cur = get(name) ?? get(BODY_STYLE);
  while (cur && !seen.has(cur.name)) {
    chain.push(cur);
    seen.add(cur.name);
    cur = cur.basedOn ? get(cur.basedOn) : undefined;
  }
  let para: ParaAttrs = {};
  let marks: MarkSet = {};
  for (let k = chain.length - 1; k >= 0; k--) {
    const s = chain[k]!;
    if (s.para) para = mergeParaAttrs(para, s.para);
    if (s.marks) marks = { ...marks, ...s.marks };
  }
  return { para, marks, chain: chain.map((s) => s.name) };
}
