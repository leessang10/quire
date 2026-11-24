/**
 * 쪽마다 머리말·꼬리말과 필드 값 (12 §5). DOM을 쓰지 않는다: 편집기 그리기와 기준 문서 시험이 같이 쓴다.
 *
 * - 쪽의 구역 = 그 쪽의 모양을 정하는 구역 (SectionFrames.pageOwner). 짝·홀수 시작으로 넣은 빈 쪽도 새 구역의 쪽이다.
 * - 쪽 번호: 쪽 번호를 다시 시작하는 가장 가까운 앞 구역(pageNumber.start)부터 센다. 없으면 문서 쪽 차례 + 1. 빈 쪽도 센다.
 * - 종류: 구역 첫 쪽이고 titlePage면 first, oddEven이고 쪽 번호가 짝수면 even, 아니면 default. 스토리는 앞 구역에서 이어 쓴다.
 * - 본문 프레임은 자리표시 값으로 잰 높이로 정해지므로(Formatter.syncSections) 여기의 값은 본문 배치에 영향이 없다.
 */
import { DEFAULT_HF_DISTANCE, formatPageNumber, fullSection, hfKindOf, type Doc, type HFKind, type HFPart } from '@quiredoc/model';
import { SectionFrames, type PageBox, type PagedLayout } from '@quiredoc/layout';
import { pt, type FieldValues, type Formatter } from './formatter';

/** 쪽 하나의 머리말·꼬리말 자리 */
export interface PageHF {
  page: number;
  /** 쪽을 가진 구역의 차례·ID */
  section: number;
  sectionId: string;
  /** 구역 안의 몇 번째 쪽 (0부터) */
  pageInSection: number;
  kind: HFKind;
  /** 이 쪽의 필드 값 */
  fields: FieldValues;
  box: PageBox;
  /** 머리말: 스토리(없으면 null), 왼쪽 위 (문서 좌표), 폭 */
  header: { story: string | null; x: number; y: number; width: number };
  /** 꼬리말: 아래쪽 끝 y (스토리 높이만큼 위에 놓는다) */
  footer: { story: string | null; x: number; bottom: number; width: number };
  /** 본문 영역 위·아래 (문서 y): 그 위가 머리말, 그 아래가 꼬리말 영역 */
  bodyTop: number;
  bodyBottom: number;
}

/** 오늘 날짜 필드 값 (예: 2026. 11. 18.) */
export function dateText(d = new Date()): string {
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 쪽 p의 쪽 번호 (숫자)와 그 쪽의 구역 */
export function pageNumberOf(fmt: Formatter, layout: PagedLayout, p: number): { n: number; section: number; first: number; end: number } {
  const frames = layout.frames;
  const own = frames instanceof SectionFrames ? frames.pageOwner(p) : { index: 0, first: 0, end: Infinity };
  const secs = fmt.sectionList();
  for (let j = Math.min(own.index, secs.length - 1); j >= 0; j--) {
    const start = secs[j]!.def?.pageNumber?.start;
    if (start === undefined) continue;
    const first = j === own.index ? own.first : (frames as SectionFrames).firstPageOf(j);
    if (first >= 0) return { n: start + (p - first), ...own, section: own.index };
  }
  return { n: p + 1, section: own.index, first: own.first, end: own.end };
}

/** 쪽 p의 머리말·꼬리말 자리와 필드 값 */
export function pageHF(fmt: Formatter, layout: PagedLayout, p: number, date = dateText()): PageHF {
  const { n, section, first, end } = pageNumberOf(fmt, layout, p);
  const secs = fmt.sectionList();
  const s = secs[Math.min(section, secs.length - 1)]!;
  const f = fullSection(s.def);
  const kind = hfKindOf(s.def, p - first, n);
  const pages = layout.pageCount;
  const fields: FieldValues = {
    page: formatPageNumber(n, f.pageNumber?.format),
    pages: String(pages),
    sectionPages: String(Math.max(1, Math.min(end, pages) - first)),
    date,
  };
  const box = layout.pageBox(p);
  const g = s.geom;
  const x = box.x + g.left;
  const width = g.width - g.left - g.right;
  return {
    page: p,
    section,
    sectionId: s.id,
    pageInSection: p - first,
    kind,
    fields,
    box,
    bodyTop: box.top + g.top,
    bodyBottom: box.top + box.height - g.bottom,
    header: { story: s.header[kind] ?? null, x, y: box.top + pt(f.headerDistance ?? DEFAULT_HF_DISTANCE), width },
    footer: { story: s.footer[kind] ?? null, x, bottom: box.top + box.height - pt(f.footerDistance ?? DEFAULT_HF_DISTANCE), width },
  };
}

/** 쪽의 머리말·꼬리말을 그 쪽 값으로 조판하고 자리에 놓는다 (스토리가 없으면 null) */
export function layoutHF(fmt: Formatter, doc: (id: string) => Doc, hf: PageHF, part: HFPart, preedit: { offset: number; text: string; fmt?: number } | null = null): PagedLayout | null {
  const slot = part === 'header' ? hf.header : hf.footer;
  if (!slot.story) return null;
  const L = fmt.layoutStory(doc(slot.story), slot.width, hf.fields, preedit);
  const y = part === 'header' ? hf.header.y : hf.footer.bottom - L.contentBottom;
  L.setOrigin(slot.x, y);
  return L;
}

/** 머리말·꼬리말의 글 (필드는 값으로): 시험·접근성 */
export function hfText(fmt: Formatter, doc: Doc, fields: FieldValues): string {
  const out: string[] = [];
  for (const p of doc.paragraphs()) {
    let t = '';
    let k = 0;
    for (const ch of p.text) {
      const o = p.objs?.get(k);
      t += o?.kind === 'field' ? fields[o.field!] ?? '?' : ch === '￼' ? '' : ch;
      k++;
    }
    out.push(t);
  }
  void fmt;
  return out.join('\n');
}
