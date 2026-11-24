/**
 * 머리말·꼬리말과 필드 (12 §5): 본문 프레임은 자리표시 값으로 잰 머리말 높이로만 정해지고, 쪽 번호는 조립된 쪽 목록에서 센다.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SECTION, Doc, Document, LAST_SECTION, hfStoryId, type SectionProps } from '@quiredoc/model';
import { LayoutCache, PagedLayout, SectionFrames, type Measurer } from '@quiredoc/layout';
import { Formatter, defaultPageSetup } from './formatter';
import { hfText, layoutHF, pageHF } from './headers';

const measurer: Measurer = { width: (g, face = 0) => (g.codePointAt(0)! >= 0x1100 ? 16 : 8) + face };
const NL = '\n';

function make(paras: number, text = '본문 문단입니다. 줄을 채우는 글.') {
  const doc = Doc.fromText(Array.from({ length: paras }, (_, i) => `${i + 1}. ${text}`).join(NL));
  doc.takeParagraphChanges();
  return new Document(doc);
}

function compose(document: Document) {
  const setup = defaultPageSetup(16);
  const fmt = new Formatter(() => document, setup, 16);
  fmt.reset(measurer, new LayoutCache(5000));
  const layout = new PagedLayout(setup, measurer, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  document.body.takeParagraphChanges();
  layout.update(document.body.paragraphs(), null, Infinity, null);
  layout.finish();
  return { setup, fmt, layout };
}

/** 모든 줄 (쪽, y) */
const lines = (L: PagedLayout) => L.paras.flatMap((p) => p!.lines.map((ln) => [ln.page, ln.y] as const));

/** 편집기처럼: 머리말이 바뀌었으면 쪽 모양이 바뀐 구역 첫 문단부터 다시 놓는다 */
function relayout(document: Document, c: ReturnType<typeof compose>) {
  const i = c.fmt.syncSections();
  if (i >= 0) document.body.touchParagraph(i === 0 ? 0 : document.body.sectionBreaks()[i - 1]! + 1);
  c.layout.update(document.body.paragraphs(), null, Infinity, document.body.takeParagraphChanges());
  c.layout.finish();
  return i;
}

function setHeader(document: Document, section: string, def: Partial<SectionProps>) {
  const b = document.body;
  b.setSection(section, { ...DEFAULT_SECTION, ...(b.sectionDef(section) ?? {}), ...def } as SectionProps);
}

describe('headers and footers (12 §5)', () => {
  it('a header inside the margin leaves the body as it was; a tall one pushes it down, only from that section', () => {
    const document = make(120);
    const plain = compose(document);
    const before = lines(plain.layout);
    const hdr = hfStoryId('header', LAST_SECTION, 'default');
    document.story(hdr).insertText(0, '머리말');
    setHeader(document, LAST_SECTION, { header: { default: hdr } });
    const c = compose(document);
    expect(lines(c.layout)).toEqual(before); // 36pt + 한 줄 < 72pt 여백
    // 머리말 줄을 늘리면 본문이 밀린다 (편집기의 증분 = 처음부터)
    document.story(hdr).insertText(3, '\n둘째 줄\n셋째 줄');
    expect(relayout(document, c)).toBe(0);
    const fresh = compose(document);
    expect(lines(c.layout)).toEqual(lines(fresh.layout));
    const top = c.layout.paras[0]!.lines[0]!.y - c.layout.pageBox(0).top;
    expect(top).toBe(Math.ceil(48 + c.fmt.storyHeight(hdr, 794 - 192)));
    expect(lines(c.layout)).not.toEqual(before);
    // 높이가 그대로인 머리말 편집: 본문을 다시 놓지 않는다 (12 G3)
    document.story(hdr).insertText(1, '가');
    expect(relayout(document, c)).toBe(-1);
    expect(c.layout.counts.reflowed + c.layout.counts.repositioned).toBe(0);
  });

  it('fields take their page values; the body does not depend on them', () => {
    const document = make(400);
    const ftr = hfStoryId('footer', LAST_SECTION, 'default');
    const s = document.story(ftr);
    s.insertObject(0, { kind: 'field', field: 'page' });
    s.insertText(1, ' / ');
    s.insertObject(4, { kind: 'field', field: 'pages' });
    setHeader(document, LAST_SECTION, { footer: { default: ftr } });
    const c = compose(document);
    const n = c.layout.pageCount;
    expect(n).toBeGreaterThan(9);
    const texts = Array.from({ length: n }, (_, p) => {
      const hf = pageHF(c.fmt, c.layout, p);
      return hfText(c.fmt, document.story(hf.footer.story!), hf.fields);
    });
    expect(texts[0]).toBe(`1 / ${n}`);
    expect(texts[9]).toBe(`10 / ${n}`);
    // 쪽 번호마다 필드 폭이 다르다 (자리표시 999가 아니라 그 쪽 값)
    const w = (p: number) => {
      const L = layoutHF(c.fmt, (id) => document.story(id), pageHF(c.fmt, c.layout, p), 'footer')!;
      const ln = L.paras[0]!.lines[0]!;
      return L.paras[0]!.layout.objs!.get(0)!.w + ln.y * 0;
    };
    expect(w(9)).toBeGreaterThan(w(0));
    // 꼬리말은 아래 여백 안, 아래 끝이 용지 끝에서 36pt
    const hf = pageHF(c.fmt, c.layout, 3);
    const L = layoutHF(c.fmt, (id) => document.story(id), hf, 'footer')!;
    const ln = L.paras.at(-1)!.lines.at(-1)!;
    expect(ln.y + ln.height).toBeCloseTo(hf.box.top + hf.box.height - 48);
  });

  it('page numbers restart per section, count blank pages, and headers carry over to later sections', () => {
    const document = make(90);
    const b = document.body;
    // 구역 a: 문단 0–29, 구역 b(홀수 쪽 시작, 쪽 번호 i부터 로마 숫자): 30–59, 마지막: 60–
    b.setParaAttr(29, 'section', 'a');
    b.setSection('a', { ...DEFAULT_SECTION });
    b.setParaAttr(59, 'section', 'b');
    b.setSection('b', { ...DEFAULT_SECTION, start: 'evenPage', pageNumber: { start: 1, format: 'roman' } });
    b.setSection(LAST_SECTION, { ...DEFAULT_SECTION, titlePage: true });
    const hdr = hfStoryId('header', 'a', 'default');
    document.story(hdr).insertText(0, '첫 구역 머리말');
    b.setSection('a', { ...DEFAULT_SECTION, header: { default: hdr } });
    const c = compose(document);
    const all = Array.from({ length: c.layout.pageCount }, (_, p) => pageHF(c.fmt, c.layout, p));
    const sec = (i: number) => all.filter((h) => h.section === i);
    expect(sec(0)[0]!.fields.page).toBe('1');
    // 짝수 쪽 시작: 본문은 짝수 쪽에서. 그 앞에 빈 쪽이 있으면 새 구역의 쪽으로 센다
    const b0 = sec(1)[0]!;
    expect((c.layout.para(30).lines[0]!.page + 1) % 2).toBe(0);
    expect(b0.page).toBe(sec(0).at(-1)!.page + 1);
    expect(b0.fields.page).toBe('i');
    expect(sec(1).map((h) => h.fields.page).slice(0, 3)).toEqual(['i', 'ii', 'iii']);
    expect(b0.fields.sectionPages).toBe(String(sec(1).length));
    // 이어 쓰기: 구역 b·마지막 구역도 구역 a의 머리말
    expect(all.every((h) => h.kind === 'first' || h.header.story === hdr)).toBe(true);
    // 마지막 구역은 titlePage: 첫 쪽은 first (스토리 없음 → 비움), 번호는 구역 b에서 이어서 세고 모양은 그 구역의 것 (Word와 같다)
    const last = sec(2);
    expect(last[0]!.kind).toBe('first');
    expect(last[0]!.header.story).toBe(null);
    expect(last[0]!.fields.page).toBe(String(sec(1).length + 1));
  });
});

