/**
 * 쪽 그리기기 (15 §5.1): DOM 없이 Node에서 쪽을 그린다. 기록 대상의 지문이 결정적이고, 쪽 내용(본문·표·각주·머리말 필드·서식)이
 * 그려지며, 덧그리기 갈고리가 그리기 순서대로 불린다
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SECTION, Doc, Document, LAST_SECTION, cellStoryId, hfStoryId, noteStoryId, type SectionProps } from '@quire/model';
import { LayoutCache, PagedLayout, SectionFrames, type Measurer } from '@quire/layout';
import { Formatter, defaultPageSetup } from './formatter';
import { RecordingTarget } from './paint';
import { DEFAULT_METRICS, PagePainter, type PaintOverlay } from './painter';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const NL = '\n';

function compose(document: Document) {
  const setup = defaultPageSetup(16);
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(measurer, new LayoutCache(5000));
  // 머리말·꼬리말 구역을 서식기에 알린다 (편집기처럼)
  fmt.syncSections();
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  document.body.takeParagraphChanges();
  layout.update(document.body.paragraphs(), null, Infinity, null);
  layout.finish();
  const painter = new PagePainter({
    fmt,
    document,
    layout,
    setup,
    fontSize: 16,
    family: 'sans-serif',
    metrics: DEFAULT_METRICS,
    shapedFonts: null,
    boldFonts: [],
    today: '2026. 11. 20.',
    images: { state: () => 'ready' },
  });
  return { fmt, layout, painter };
}

/** 본문, 서식, 목록, 표, 각주, 그림, 꼬리말 쪽 번호가 있는 문서 */
function richDocument(): Document {
  const doc = Doc.fromText(
    ['보고서 제목', '굵은 글과 기울인 글이 섞인 문단입니다.', '첫째 항목', '둘째 항목', '표 앞 문단', '각주가 달린 문단입니다.', ...Array.from({ length: 60 }, (_, i) => `${i + 1}. 쪽을 넘기는 본문 문단입니다. 줄을 채우는 글이 이어집니다.`)].join(NL),
  );
  const document = new Document(doc);
  const ps = () => doc.paragraphs();
  doc.format(ps()[1]!.start, ps()[1]!.start + 5, 'bold', true);
  doc.format(ps()[1]!.start + 6, ps()[1]!.start + 12, 'italic', true);
  doc.format(ps()[1]!.start + 13, ps()[1]!.start + 16, 'underline', true);
  doc.format(ps()[1]!.start + 17, ps()[1]!.start + 20, 'highlight', '#fff59d');
  const [bullet] = doc.createList('bullet');
  const [number] = doc.createList('number');
  doc.setParaAttr(2, 'list', { id: bullet, level: 0 });
  doc.setParaAttr(3, 'list', { id: number, level: 0 });
  doc.insertObject(ps()[5]!.start + 4, { id: 'n1', kind: 'note' });
  document.story(noteStoryId('n1')).insertText(0, '각주 내용입니다.');
  doc.insertObject(ps()[6]!.start, { id: 'img1', kind: 'image', asset: 'a'.repeat(32), w: 72000, h: 36000 });
  const { id } = document.insertTable(ps()[4]!.end, 2, 2, 200000);
  const t = document.table(id)!;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) document.story(cellStoryId(id, t.rows[r]!, t.cols[c]!)).insertText(0, `칸 ${r}-${c}`);
  const ftr = hfStoryId('footer', LAST_SECTION, 'default');
  const s = document.story(ftr);
  s.insertObject(0, { kind: 'field', field: 'page' });
  s.insertText(1, ' / ');
  s.insertObject(4, { kind: 'field', field: 'pages' });
  doc.setSection(LAST_SECTION, { ...DEFAULT_SECTION, ...(doc.sectionDef(LAST_SECTION) ?? {}), footer: { default: ftr } } as SectionProps);
  doc.takeParagraphChanges();
  return document;
}

describe('page painter (15 §5.1)', () => {
  it('paints a page without the DOM; the fingerprint is deterministic', () => {
    const a = compose(richDocument());
    const b = compose(richDocument());
    expect(a.layout.pageCount).toBeGreaterThan(1);
    for (let p = 0; p < a.layout.pageCount; p++) {
      const ra = new RecordingTarget();
      const rb = new RecordingTarget();
      a.painter.paintPage(p, ra);
      b.painter.paintPage(p, rb);
      expect(ra.commands.length).toBeGreaterThan(10);
      expect(ra.fingerprint()).toBe(rb.fingerprint());
    }
    // 쪽마다 다르다
    const f = (p: number) => {
      const r = new RecordingTarget();
      a.painter.paintPage(p, r);
      return r.fingerprint();
    };
    expect(f(0)).not.toBe(f(1));
  });

  it('page content: text, formatting, list markers, table cells, image, footnote, footer fields', () => {
    const { painter, layout } = compose(richDocument());
    const r = new RecordingTarget();
    painter.paintPage(0, r);
    const texts = r.texts();
    expect(texts).toContain('보고서 제목');
    expect(texts).toContain('칸 0-0');
    expect(texts).toContain('칸 1-1');
    expect(texts).toContain('각주가');
    expect(texts.join(' ')).toContain('각주 내용입니다.');
    // 꼬리말: 그 쪽의 값 (자리표시 999가 아님)
    expect(texts).toContain('1');
    expect(texts).toContain(String(layout.pageCount));
    expect(texts).not.toContain('999');
    // 목록 기호와 번호
    expect(texts.some((t) => t === '•' || t.startsWith('•'))).toBe(true);
    expect(texts.filter((t) => t === '1.').length).toBeGreaterThan(1); // 번호 목록 + 본문 '1.'
    // 기울임, 굵게, 밑줄(사각형), 형광펜
    const cmds = r.commands;
    expect(cmds.some((c) => c[0] === 'text' && (c[5] as number) > 0)).toBe(true);
    expect(cmds.some((c) => c[0] === 'text' && c[4] === true)).toBe(true);
    expect(cmds.some((c) => c[0] === 'fillRect' && c[5] === '#fff59d')).toBe(true);
    expect(cmds.some((c) => c[0] === 'image' && c[1] === 'a'.repeat(32))).toBe(true);
    // 표 테두리
    expect(cmds.filter((c) => c[0] === 'strokeRect').length).toBeGreaterThanOrEqual(4);
    // 쪽 좌표: 쪽 밖에 그리지 않는다 (쪽 왼쪽 위가 0, 0)
    const pb = layout.pageBox(0);
    for (const c of cmds) if (c[0] === 'text') expect((c[8] as number) >= 0 && (c[8] as number) <= pb.height).toBe(true);
  });

  it('second page: page number field takes that page value', () => {
    const { painter, layout } = compose(richDocument());
    const r = new RecordingTarget();
    painter.paintPage(1, r);
    expect(r.texts()).toContain('2');
    expect(r.texts()).toContain(String(layout.pageCount));
  });

  it('overlay hooks run in paint order around each line', () => {
    const { painter } = compose(richDocument());
    const r = new RecordingTarget();
    const order: string[] = [];
    const overlay: PaintOverlay = {
      story: () => ({
        back: () => order.push('back'),
        under: () => order.push('under'),
        over: () => order.push('over'),
      }),
      cell: () => order.push('cell'),
      object: (o) => order.push(o.float ? 'float' : 'object'),
      hf: () => {
        order.push('hf');
        return null;
      },
    };
    painter.paintPage(0, r, overlay);
    expect(order.slice(0, 2)).toEqual(['hf', 'hf']); // 머리말·꼬리말을 본문보다 먼저
    const body = order.filter((o) => o !== 'hf');
    expect(body.slice(0, 3)).toEqual(['back', 'under', 'over']);
    expect(order).toContain('cell');
    expect(order).toContain('object');
    // 줄마다 back → under → over
    const lines = order.filter((o) => o === 'back' || o === 'under' || o === 'over').join(',');
    expect(lines).toMatch(/^(back,under,over,?)+$/);
  });
});
