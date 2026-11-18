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
  titlePage?: boolean;
  headerDistance?: number;
  footerDistance?: number;
  /** 쪽 번호 (3-4) */
  pageNumber?: { start?: number; format?: 'decimal' | 'roman' | 'hangul' };
}

export type SectionStart = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage';
export type SectionKey = keyof SectionProps;
export const SECTION_KEYS: readonly SectionKey[] = ['page', 'start', 'columns', 'header', 'footer', 'titlePage', 'headerDistance', 'footerDistance', 'pageNumber'];

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

/** 빠진 키를 기본값으로 채운 구역 설정 */
export function fullSection(def: Partial<SectionProps> | undefined): SectionProps {
  return { ...DEFAULT_SECTION, ...(def ?? {}) } as SectionProps;
}
