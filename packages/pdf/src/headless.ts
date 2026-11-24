/**
 * 브라우저 없이 정본 → PDF (15 §5.4 서버 실행): 정본을 문서로 열고, 주어진 글꼴 파일로 셰이핑·조판해 exportPdf로 낸다.
 * 편집기(DOM)를 만들지 않는다. 서버·CLI·시험에서 쓴다.
 */
import { DEFAULT_METRICS, Formatter, defaultPageSetup, type PainterEnv } from '@quiredoc/editor';
import { LayoutCache, PagedLayout, SectionFrames } from '@quiredoc/layout';
import { HbShaper, loadShapingFont, slotOf, type FontSlot } from '@quiredoc/shaping';
import { documentFromQuire, type QuireDoc } from '@quiredoc/model';
import { exportPdf, type PdfResult } from './export';
import type { PdfFontSource } from './fonts';
import type { Subsetter } from './subset';

/** 글꼴 자리 하나: 보통 굵기 파일, 있으면 굵은 얼굴. 앞이 먼저 쓰인다 (글자가 없으면 다음 자리) */
export interface HeadlessFont {
  name: string;
  bytes: Uint8Array;
  bold?: Uint8Array;
}

export interface PdfFromQuireOptions {
  fonts: HeadlessFont[];
  subsetter: Subsetter | null;
  /** 이미지 자산 바이트 */
  asset?(id: string): Promise<Uint8Array | null>;
  title?: string;
  /** 기본 글자 크기 (px, 편집기와 같은 16) */
  fontSize?: number;
  /** 날짜 필드 값 */
  today?: string;
}

/** 정본 → PDF 바이트 (편집기와 같은 조판) */
export async function pdfFromQuire(q: QuireDoc, opts: PdfFromQuireOptions): Promise<PdfResult> {
  if (!opts.fonts.length) throw new Error('pdfFromQuire: 글꼴이 하나는 있어야 합니다');
  const fontSize = opts.fontSize ?? 16;
  const { document } = documentFromQuire(q);
  const setup = defaultPageSetup(fontSize);
  const fmt = new Formatter(() => document, setup, fontSize);
  const shaping = opts.fonts.map((f) => ({ regular: loadShapingFont(f.bytes, f.name), bold: f.bold ? loadShapingFont(f.bold, `${f.name} Bold`) : null }));
  const slots: FontSlot[] = shaping.map((s) => ({ ...slotOf(s.regular), bold: s.bold ? slotOf(s.bold) : null }));
  const shaper = new HbShaper(slots, { size: fontSize });
  fmt.reset(shaper, new LayoutCache(5000));
  fmt.syncSections();
  // 기준선·밑줄은 공백을 가진 첫 글꼴의 치수로 (편집기와 같다)
  const base = shaping.find((s) => s.regular.has(0x20))?.regular ?? shaping[0]!.regular;
  setup.ascent = base.metrics.ascent;
  setup.descent = base.metrics.descent;
  const layout = new PagedLayout(setup, shaper, new LayoutCache(), fmt.formatOf, new SectionFrames(setup, fmt.sections));
  document.body.takeParagraphChanges();
  layout.update(document.body.paragraphs(), null, Infinity, null);
  layout.finish();
  const env: PainterEnv = {
    fmt,
    document,
    layout,
    setup,
    fontSize,
    family: 'sans-serif',
    metrics: { ...DEFAULT_METRICS, ...base.metrics },
    shapedFonts: opts.fonts.map((_, i) => `f${i}`),
    boldFonts: opts.fonts.map((f, i) => (f.bold ? `f${i}b` : null)),
    today: opts.today,
    images: { state: () => 'ready' },
  };
  const fonts: PdfFontSource = {
    count: opts.fonts.length,
    face: (slot, bold) => {
      const f = opts.fonts[slot];
      if (!f) return null;
      if (bold) return f.bold ? { bytes: f.bold, name: `${f.name} Bold` } : null;
      return { bytes: f.bytes, name: f.name };
    },
  };
  return exportPdf({ env, fonts, subsetter: opts.subsetter, title: opts.title, asset: opts.asset ?? (async () => null) });
}
