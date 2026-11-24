/**
 * PDF 내보내기 (15 §5.2–5.3): 쪽 그리기기로 쪽마다 PdfPage에 그리고, 글꼴(부분화)·이미지·책갈피(제목 문단)·링크를 넣는다.
 * 순서: ① 미리 그려 쓰는 이미지 자산을 모은다 ② 이미지를 받아 XObject로 쓴다 ③ 쪽을 그린다 ④ 글꼴을 부분화해 쓴다
 * ⑤ 내용 스트림(글리프 → CID)과 쪽을 쓴다. DOM 없이 Node에서도 돈다.
 */
import { OBJ, type ParagraphInfo } from '@quiredoc/model';
import { PagePainter, type FontRef, type PainterEnv, type PaintTarget, type TextRun } from '@quiredoc/editor';
import { PdfFonts, type PdfFontSource } from './fonts';
import { writeImage, type Inflate } from './images';
import type { Subsetter } from './subset';
import { PdfPage, PdfResources, PT } from './target';
import { PdfWriter, name, streamDeflate, streamInflate, textString, type Deflate, type PdfValue, type Ref } from './writer';

export interface PdfExportOptions {
  /** 편집기의 그리기 환경 (조판한 본문 레이아웃) */
  env: PainterEnv;
  fonts: PdfFontSource;
  /** 자산 바이트 (없으면 null: 자리표시로 그린다) */
  asset(id: string): Promise<Uint8Array | null>;
  /** 글꼴 부분화기 (없으면 글꼴 파일을 통째로 넣는다) */
  subsetter: Subsetter | null;
  title?: string;
  deflate?: Deflate;
  inflate?: Inflate;
}

export interface PdfResult {
  bytes: Uint8Array;
  pages: number;
  /** 얼굴이 없어 빠진 글자 수 */
  missingGlyphs: number;
  fonts: number;
  images: number;
}

/** 이미지 자산만 모으는 대상 (글자는 재지 않는다) */
class AssetCollector implements PaintTarget {
  readonly exactRuns = true;
  readonly assets = new Set<string>();
  save(): void {}
  restore(): void {}
  alpha(): void {}
  clip(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  text(_run: TextRun): void {}
  measure(text: string, font: FontRef): number {
    return Array.from(text).length * font.size * 0.5;
  }
  image(asset: string): void {
    this.assets.add(asset);
  }
}

interface OutlineItem {
  title: string;
  level: number;
  page: number;
  /** 쪽 위에서 (pt) */
  y: number;
  children: OutlineItem[];
}

/** 제목 문단(h1–h3)으로 책갈피 나무 */
function outlineOf(env: PainterEnv): OutlineItem[] {
  const { layout } = env;
  const roots: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  for (let i = 0; i < layout.validCount; i++) {
    const para = layout.paras[i]!;
    const info = para.info as ParagraphInfo;
    const m = /^h([1-3])$/.exec(info.attrs.style ?? '');
    const ln = para.lines[0];
    if (!m || !ln) continue;
    const title = info.text.replaceAll(OBJ, '').trim();
    if (!title) continue;
    const box = layout.pageBox(ln.page);
    const item: OutlineItem = { title, level: Number(m[1]), page: ln.page, y: (ln.y - box.top) * PT, children: [] };
    while (stack.length && stack[stack.length - 1]!.level >= item.level) stack.pop();
    (stack.length ? stack[stack.length - 1]!.children : roots).push(item);
    stack.push(item);
  }
  return roots;
}

/** 링크 주소 → PDF 글자열 (ASCII: 그 밖은 퍼센트 인코딩) */
function uri(href: string): string {
  try {
    return encodeURI(decodeURI(href));
  } catch {
    return encodeURI(href);
  }
}

export async function exportPdf(o: PdfExportOptions): Promise<PdfResult> {
  const deflate = o.deflate ?? streamDeflate;
  const inflate = o.inflate ?? streamInflate;
  const w = new PdfWriter(deflate);
  const base = o.env;
  base.layout.ensureThroughY(Infinity);
  const count = base.layout.pageCount;

  // ① 이미지 자산
  const states = new Map<string, 'ready' | 'error'>();
  const dry = new PagePainter({ ...snapshot(base), images: { state: () => 'ready' } });
  const collector = new AssetCollector();
  for (let p = 0; p < count; p++) dry.paintPage(p, collector);

  // ② 이미지
  const res = new PdfResources();
  const imageRefs = new Map<string, Ref>();
  for (const id of collector.assets) {
    const bytes = await o.asset(id).catch(() => null);
    const img = bytes ? await writeImage(w, bytes, inflate).catch(() => null) : null;
    if (img) {
      const n = `Im${imageRefs.size + 1}`;
      imageRefs.set(n, img.ref);
      res.images.set(id, n);
      states.set(id, 'ready');
    } else states.set(id, 'error');
  }

  // ③ 쪽
  const fonts = new PdfFonts(o.fonts);
  const painter = new PagePainter({ ...snapshot(base), images: { state: (a) => states.get(a) ?? 'error' } });
  const pages: PdfPage[] = [];
  let missing = 0;
  for (let p = 0; p < count; p++) {
    const box = base.layout.pageBox(p);
    const page = new PdfPage(box.width * PT, box.height * PT, fonts, res);
    painter.paintPage(p, page);
    missing += page.missing;
    pages.push(page);
  }

  // ④ 글꼴
  await fonts.write(w, o.subsetter);

  // ⑤ 쪽과 자원
  const fontDict: Record<string, PdfValue> = {};
  for (const f of fonts.used) fontDict[f.res] = f.ref!;
  const gsDict: Record<string, PdfValue> = {};
  for (const [a, n] of res.alphas) gsDict[n] = { Type: name('ExtGState'), ca: a, CA: a };
  const xobj: Record<string, PdfValue> = {};
  for (const [n, r] of imageRefs) xobj[n] = r;
  const resources = w.write({ Font: fontDict, ExtGState: gsDict, XObject: xobj, ProcSet: [name('PDF'), name('Text'), name('ImageB'), name('ImageC')] });
  const pagesRef = w.ref();
  const pageRefs = pages.map(() => w.ref());
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const contents = await w.stream({}, new TextEncoder().encode(page.serialize()));
    const annots = page.links.map((l) =>
      w.write({ Type: name('Annot'), Subtype: name('Link'), Rect: l.rect.map((v) => Math.round(v * 100) / 100), Border: [0, 0, 0], A: { Type: name('Action'), S: name('URI'), URI: uri(l.href) } }),
    );
    w.write(
      {
        Type: name('Page'),
        Parent: pagesRef,
        MediaBox: [0, 0, Math.round(page.width * 100) / 100, Math.round(page.height * 100) / 100],
        Resources: resources,
        Contents: contents,
        Annots: annots.length ? annots : undefined,
      },
      pageRefs[i],
    );
  }
  w.write({ Type: name('Pages'), Kids: pageRefs, Count: pageRefs.length }, pagesRef);

  // 책갈피
  const outline = outlineOf(base);
  let outlinesRef: Ref | undefined;
  if (outline.length) {
    outlinesRef = w.ref();
    const writeLevel = (items: OutlineItem[], parent: Ref): { first: Ref; last: Ref; count: number } => {
      const refs = items.map(() => w.ref());
      let total = 0;
      items.forEach((it, i) => {
        const kids = it.children.length ? writeLevel(it.children, refs[i]!) : null;
        total += 1 + (kids?.count ?? 0);
        const page = pages[it.page]!;
        w.write(
          {
            Title: textString(it.title),
            Parent: parent,
            Prev: i > 0 ? refs[i - 1] : undefined,
            Next: i + 1 < refs.length ? refs[i + 1] : undefined,
            First: kids?.first,
            Last: kids?.last,
            Count: kids ? kids.count : undefined,
            Dest: [pageRefs[it.page]!, name('XYZ'), 0, Math.round((page.height - it.y) * 100) / 100, null],
          },
          refs[i],
        );
      });
      return { first: refs[0]!, last: refs[refs.length - 1]!, count: total };
    };
    const top = writeLevel(outline, outlinesRef);
    w.write({ Type: name('Outlines'), First: top.first, Last: top.last, Count: top.count }, outlinesRef);
  }

  const root = w.write({
    Type: name('Catalog'),
    Pages: pagesRef,
    Outlines: outlinesRef,
    PageMode: outlinesRef ? name('UseOutlines') : undefined,
    Lang: 'ko',
    ViewerPreferences: { DisplayDocTitle: true },
  });
  const info = w.write({ Title: o.title ? textString(o.title) : undefined, Producer: 'Quire' });
  return { bytes: w.finish(root, info), pages: count, missingGlyphs: missing, fonts: fonts.used.length, images: imageRefs.size };
}

/** 게터로 된 환경을 값으로 (내보내는 동안 글꼴을 불러와도 바뀌지 않게) */
function snapshot(env: PainterEnv): PainterEnv {
  return {
    fmt: env.fmt,
    document: env.document,
    layout: env.layout,
    setup: env.setup,
    fontSize: env.fontSize,
    family: env.family,
    metrics: env.metrics,
    shapedFonts: env.shapedFonts,
    boldFonts: env.boldFonts,
    today: env.today,
    images: env.images,
  };
}
