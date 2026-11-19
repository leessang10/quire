import { formatNumber } from './lists';

/**
 * 구역 (12 §3). 구역의 끝은 그 구역 마지막 문단 ¶의 문단 속성 section: <구역 ID>다. 마지막 구역은 표시가 없고 구역 맵의
 * LAST_SECTION 항목(없으면 기본 구역)을 쓴다. 구역 설정은 문서의 구역 맵 (ID → SectionProps).
 */

/** 구역 설정. 길이는 1/1000pt */
export interface SectionProps {
  /** 용지와 여백. 방향은 width > height로 나타낸다 */
  page: { width: number; height: number; margin: [top: number, right: number, bottom: number, left: number] };
  /** 이 구역이 어떻게 시작하는가 */
  start: SectionStart;
  /** 다단 (3-6) */
  columns?: { count: number; gap: number; separator?: boolean };
  /** 머리말·꼬리말 스토리 (3-4) */
  header?: { default?: string; first?: string; even?: string };
  footer?: { default?: string; first?: string; even?: string };
  /** 첫 쪽 머리말·꼬리말 따로 (first) */
  titlePage?: boolean;
  /** 짝수 쪽 머리말·꼬리말 따로 (even) */
  oddEven?: boolean;
  /** 머리말 위·꼬리말 아래와 용지 끝 사이. 없으면 36pt */
  headerDistance?: number;
  footerDistance?: number;
  /** 쪽 번호 (3-4) */
  pageNumber?: { start?: number; format?: 'decimal' | 'roman' | 'hangul' };
}

export type SectionStart = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage';
export type SectionKey = keyof SectionProps;
export const SECTION_KEYS: readonly SectionKey[] = ['page', 'start', 'columns', 'header', 'footer', 'titlePage', 'oddEven', 'headerDistance', 'footerDistance', 'pageNumber'];

/** 마지막 구역(구역 나눔 표시가 없는 구역)의 구역 맵 키 */
export const LAST_SECTION = 'last';

/** 기본 구역: A4 세로, 여백 72pt (07 §4의 기본 구역과 같다) */
export const DEFAULT_SECTION: Readonly<SectionProps> = Object.freeze({
  page: Object.freeze({ width: 595276, height: 841890, margin: Object.freeze([72000, 72000, 72000, 72000]) as unknown as [number, number, number, number] }),
  start: 'nextPage',
});

/** 용지 크기 (1/1000pt, 세로) */
export const PAPER_SIZES: Readonly<Record<string, readonly [number, number]>> = {
  A4: [595276, 841890],
  A3: [841890, 1190551],
  A5: [419528, 595276],
  B5: [498898, 708661],
  Letter: [612000, 792000],
  Legal: [612000, 1008000],
};

/** 머리말·꼬리말과 용지 끝 사이 기본값 (Word와 같은 36pt) */
export const DEFAULT_HF_DISTANCE = 36000;

export type HFPart = 'header' | 'footer';
export type HFKind = 'default' | 'first' | 'even';

/** 머리말·꼬리말 스토리 ID (12 §5.1): hdr|<구역>|<종류>, ftr|… */
export function hfStoryId(part: HFPart, section: string, kind: HFKind): string {
  return `${part === 'header' ? 'hdr' : 'ftr'}|${section}|${kind}`;
}

/** 머리말·꼬리말 스토리인가 */
export function isHFStory(story: string): boolean {
  return story.startsWith('hdr|') || story.startsWith('ftr|');
}

/** 구역의 몇 번째 쪽(0부터)·쪽 번호(1부터 센 문서 쪽)로 쓸 머리말·꼬리말 종류 */
export function hfKindOf(def: Partial<SectionProps> | undefined, pageInSection: number, pageNumber: number): HFKind {
  if (def?.titlePage && pageInSection === 0) return 'first';
  if (def?.oddEven && pageNumber % 2 === 0) return 'even';
  return 'default';
}

/**
 * 구역 i(문서 순서)의 머리말·꼬리말 스토리: 구역 설정에 없으면 앞 구역의 것을 이어 쓴다 (Word의 "이전과 연결", 종류마다).
 * defs: 문서 순서의 구역 설정
 */
export function resolveHF(defs: ReadonlyArray<Partial<SectionProps> | undefined>, i: number, part: HFPart, kind: HFKind): string | null {
  for (let j = Math.min(i, defs.length - 1); j >= 0; j--) {
    const s = defs[j]?.[part]?.[kind];
    if (s) return s;
  }
  return null;
}

/** 쪽 번호 문자열 (12 §5.3) */
export function formatPageNumber(n: number, format: 'decimal' | 'roman' | 'hangul' = 'decimal'): string {
  if (format === 'roman') return formatNumber(n, 'lowerRoman');
  if (format === 'hangul') return formatNumber(n, 'hangul');
  return String(n);
}

/** 빠진 키를 기본값으로 채운 구역 설정 */
export function fullSection(def: Partial<SectionProps> | undefined): SectionProps {
  return { ...DEFAULT_SECTION, ...(def ?? {}) } as SectionProps;
}
