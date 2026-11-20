/**
 * 기준 문서 지문 (12 §13, 16 §5): 조판 결과를 쪽 수·쪽마다 첫 줄·레이아웃 지문으로 줄인다. DOM 없음.
 * Node 시험(reference.test.ts)과 브라우저 골든 비교(편집기 `layoutSummary()`)가 같은 함수를 쓴다.
 */
import { LayoutCache, PagedLayout, SectionFrames, cpSlice, type Measurer } from '@quire/layout';
import type { Document } from '@quire/model';
import { Formatter, defaultPageSetup } from './formatter';
import { hfText, pageHF } from './headers';

/** 편집기와 같게 처음부터 조판한다 (A4, 16px) */
export function composeReference(document: Document, measurer: Measurer, metrics: { ascent: number; descent: number }, fontSize = 16): { layout: PagedLayout; fmt: Formatter } {
  const setup = { ...defaultPageSetup(fontSize), ascent: metrics.ascent, descent: metrics.descent };
  const fmt = new Formatter(() => document, setup, fontSize);
  fmt.reset(measurer, new LayoutCache(20000));
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  document.body.takeParagraphChanges();
  layout.update(document.body.paragraphs(), null, Infinity, null);
  layout.finish();
  return { layout, fmt };
}

export interface LayoutSummary {
  pages: number;
  /** 쪽마다 용지 (px, 너비x높이): 구역마다 다르다 (12 §3) */
  paper: string[];
  /** 쪽마다 첫 줄: 문단 번호, 줄 번호, 앞 글자들 */
  pageStarts: Array<{ page: number; para: number; line: number; text: string }>;
  /** 모든 줄(표 셀 포함)의 쪽·위치·글자 범위 FNV-1a */
  fingerprint: string;
  /** 머리말·꼬리말이 있는 문서: 쪽마다 "종류|머리말|꼬리말" (필드는 그 쪽 값, 12 §5) */
  headers?: string[];
  /** 각주가 있는 문서: 쪽마다 각주 영역의 "번호[줄 from,to)" (+는 앞 쪽에서 이어 씀, 12 §6) */
  notes?: string[];
  /** 행이 쪼개지거나 제목 행을 다시 그린 표가 있는 문서: 쪽마다 표 행 조각 ("h0"은 다시 그린 제목 행, "5.1"은 5행의 둘째 조각, 12 §8) */
  tableRows?: string[];
}

export function summarizeLayout(document: Document, layout: PagedLayout, fmt: Formatter, today = '2026. 1. 1.'): LayoutSummary {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 16777619);
  };
  const bits = new Uint32Array(1);
  const f32 = new Float32Array(bits.buffer);
  const mixF = (v: number) => {
    f32[0] = v;
    mix(bits[0]!);
  };
  const pageStarts: LayoutSummary['pageStarts'] = [];
  const n = document.body.paragraphs().length;
  for (let i = 0; i < n; i++) {
    const pp = layout.para(i);
    // 표 문단: 셀 자리를 정하고 셀 줄도 지문에
    const t = (pp.info as { objs?: Map<number, { table?: string }> }).objs?.get(0)?.table;
    const v = t ? fmt.tableViews.get(t) : undefined;
    if (v) fmt.tables.place(v.input, v.measure, pp.lines);
    pp.lines.forEach((ln, k) => {
      mix(i);
      mix(ln.page);
      mix(ln.start);
      mix(ln.end);
      mixF(ln.x);
      mixF(ln.y);
      mixF(ln.height);
      if (!pageStarts.length || pageStarts[pageStarts.length - 1]!.page !== ln.page)
        pageStarts.push({ page: ln.page, para: i, line: k, text: v ? '[표]' : cpSlice(pp.layout, ln.start, Math.min(ln.end, ln.start + 16)) });
    });
    if (v)
      for (const row of v.grid.cells)
        for (const c of row) {
          if (!c) continue;
          const cell = fmt.tables.cells.get(c.story);
          if (!cell) continue;
          for (let q = 0; q < cell.view.paras.length; q++)
            for (const ln of cell.view.para(q).lines) {
              mix(ln.start);
              mix(ln.end);
              mixF(ln.x);
              mixF(ln.y);
            }
        }
  }
  const paper = Array.from({ length: layout.pageCount }, (_, p) => {
    const b = layout.pageBox(p);
    return `${b.width}x${b.height}`;
  });
  const out: LayoutSummary = { pages: layout.pageCount, paper, pageStarts, fingerprint: (h >>> 0).toString(16).padStart(8, '0') };
  if (fmt.sectionList().some((s) => Object.keys(s.header).length || Object.keys(s.footer).length)) {
    const text = (story: string | null, hf: ReturnType<typeof pageHF>) => (story ? hfText(fmt, document.story(story), hf.fields) : '');
    out.headers = Array.from({ length: layout.pageCount }, (_, p) => {
      const hf = pageHF(fmt, layout, p, today);
      return `${hf.kind}|${text(hf.header.story, hf)}|${text(hf.footer.story, hf)}`;
    });
  }
  // 표 행 조각 (12 §8)
  const rowsByPage: string[][] = Array.from({ length: layout.pageCount }, () => []);
  let splitTables = false;
  for (let i = 0; i < n; i++) {
    const pp = layout.para(i);
    if (!pp.layout.table) continue;
    for (const ln of pp.lines) {
      if (ln.repeat || (ln.part ?? 0) > 0) splitTables = true;
      rowsByPage[ln.page]!.push(`${ln.repeat ? 'h' : ''}${ln.row}${ln.part ? `.${ln.part}` : ''}`);
    }
  }
  if (splitTables) out.tableRows = rowsByPage.map((r) => r.join(' '));
  if (fmt.noteList().length)
    out.notes = Array.from({ length: layout.pageCount }, (_, p) =>
      layout
        .notesOnPage(p)
        .map((n) => `${fmt.noteNumber(n.id)}[${n.from},${n.to})${n.cont ? '+' : ''}`)
        .join(' '),
    );
  return out;
}

