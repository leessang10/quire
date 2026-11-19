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
import { documentFromQuire, migrateQuire } from '@quire/sync';
import { HbShaper, loadShapingFont, slotOf } from '@quire/shaping';
import { LayoutCache, PagedLayout, SectionFrames, cpSlice } from '@quire/layout';
import type { Document } from '@quire/model';
import { Formatter, defaultPageSetup } from './formatter';
import { hfText, pageHF } from './headers';

const root = join(__dirname, '../../..');
const dir = join(root, 'fixtures/docs');
const font = (p: string, name: string) => loadShapingFont(readFileSync(join(root, p)), name);
const pretendard = font('fonts/pretendard/Pretendard-Regular.otf', 'Pretendard');
const pretendardBold = font('fonts/pretendard/Pretendard-Bold.otf', 'Pretendard Bold');
const noto = font('fonts/noto-sans-kr/NotoSansKR-Regular.otf', 'Noto Sans KR');
const shaper = new HbShaper([{ ...slotOf(pretendard), bold: slotOf(pretendardBold) }, noto], { size: 16 });

/** 편집기와 같게 조판 (A4, 16px, 셰이핑) */
function compose(document: Document) {
  const setup = { ...defaultPageSetup(16), ascent: pretendard.metrics.ascent, descent: pretendard.metrics.descent };
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(shaper, new LayoutCache(20000));
  const layout = new PagedLayout(setup, shaper, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  document.body.takeParagraphChanges();
  layout.update(document.body.paragraphs(), null, Infinity, null);
  layout.finish();
  return { layout, fmt };
}

interface Summary {
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
}

function summarize(document: Document, { layout, fmt }: ReturnType<typeof compose>): Summary {
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
  const pageStarts: Summary['pageStarts'] = [];
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
          for (let q = 0; q < cell.layout.paras.length; q++)
            for (const ln of cell.layout.para(q).lines) {
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
  const out: Summary = { pages: layout.pageCount, paper, pageStarts, fingerprint: (h >>> 0).toString(16).padStart(8, '0') };
  if (fmt.sectionList().some((s) => Object.keys(s.header).length || Object.keys(s.footer).length)) {
    const text = (story: string | null, hf: ReturnType<typeof pageHF>) => (story ? hfText(fmt, document.story(story), hf.fields) : '');
    out.headers = Array.from({ length: layout.pageCount }, (_, p) => {
      const hf = pageHF(fmt, layout, p, '2026. 1. 1.');
      return `${hf.kind}|${text(hf.header.story, hf)}|${text(hf.footer.story, hf)}`;
    });
  }
  if (fmt.noteList().length)
    out.notes = Array.from({ length: layout.pageCount }, (_, p) =>
      layout
        .notesOnPage(p)
        .map((n) => `${fmt.noteNumber(n.id)}[${n.from},${n.to})${n.cont ? '+' : ''}`)
        .join(' '),
    );
  return out;
}

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
