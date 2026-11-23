/**
 * 변환 공통 (15 §6.2): 모든 변환은 정본 JSON(QuireDoc)을 거친다. 가져오기 결과, 버린 요소 보고, 자산(이미지 바이트),
 * 포맷이 쓰는 덧붙인 스타일(제목 4–6, 코드), 이미지 크기 읽기.
 */
import type { DropCounts, DropKind } from '@quire/editor';
import { DEFAULT_STYLES, safeLink, type Style } from '@quire/model';
import { assetIdOf, quireFromText, type QuireDoc, type QuireParagraph, type QuireTable } from '@quire/sync';

/** 가져오며 버린 것: 무엇 → 개수 (15 §6.1 "가져올 때 모르는 요소는 버리고 버린 요소 수를 알린다") */
export interface ImportReport {
  /** 종류 → 개수. 화면 이름은 편집기 메시지 `drop.<종류>` (`dropMessageKey`) */
  dropped: DropCounts;
}

export interface ImportedAsset {
  bytes: Uint8Array;
  type: string;
}

export interface ImportResult {
  doc: QuireDoc;
  /** 문서가 쓰는 새 자산 (자산 ID → 바이트). 편집기의 자산 저장소에 넣는다 */
  assets: Map<string, ImportedAsset>;
  report: ImportReport;
}

/** 내보낼 때 자산 바이트를 받는다 (없으면 null: 대체 텍스트만) */
export type AssetReader = (id: string) => Promise<ImportedAsset | null>;

export class Report implements ImportReport {
  readonly dropped: DropCounts = {};
  drop = (what: DropKind): void => {
    this.dropped[what] = (this.dropped[what] ?? 0) + 1;
  };
}

/** 정본의 모든 런 (스토리마다, 표 블록은 건너뜀: 셀은 따로 스토리다) */
function* allRuns(q: QuireDoc): Generator<{ m?: Record<string, unknown> }> {
  for (const story of Object.values(q.stories)) {
    if (!Array.isArray(story)) continue;
    for (const b of story as Array<QuireParagraph | QuireTable>) if ('c' in b && Array.isArray(b.c)) yield* b.c as Array<{ m?: Record<string, unknown> }>;
  }
}

const hasUnsafeLink = (r: { m?: Record<string, unknown> }) => r.m?.link !== undefined && safeLink(r.m.link) === null;

/**
 * 위험한 링크(16 §6: javascript:, data: …)를 런에서 뺀다. q를 고치고 뺀 런 수를 돌려준다.
 * 가져오기는 끝에서 불러 보고서에 '위험한 링크'로 남긴다
 */
export function stripUnsafeLinks(q: QuireDoc): number {
  let n = 0;
  for (const r of allRuns(q)) {
    if (!hasUnsafeLink(r)) continue;
    delete r.m!.link;
    if (Object.keys(r.m!).length === 0) delete r.m;
    n++;
  }
  return n;
}

/** 내보내기용: 위험한 링크가 없으면 q 그대로, 있으면 뺀 사본 (부른 쪽 문서는 그대로) */
export function withSafeLinks(q: QuireDoc): QuireDoc {
  for (const r of allRuns(q)) {
    if (!hasUnsafeLink(r)) continue;
    const copy = structuredClone(q);
    stripUnsafeLinks(copy);
    return copy;
  }
  return q;
}

/** 가져오기 끝: 위험한 링크를 빼고 보고한다 */
export function finishImport(q: QuireDoc, report: Report): void {
  const n = stripUnsafeLinks(q);
  if (n) report.dropped.unsafeLink = (report.dropped.unsafeLink ?? 0) + n;
}

/** 기본 스타일에 없는 것: 가져온 문서가 쓰면 정본 styles에 넣는다 (크기 1/1000pt) */
export const EXTRA_STYLES: Record<string, Style> = {
  h4: { name: 'h4', label: '제목 4', basedOn: 'body', next: 'body', para: { space: { before: 10000, after: 3000 }, keepWithNext: true }, marks: { bold: true, size: 12000 } },
  h5: { name: 'h5', label: '제목 5', basedOn: 'body', next: 'body', para: { space: { before: 8000, after: 2000 }, keepWithNext: true }, marks: { bold: true, size: 11000 } },
  h6: { name: 'h6', label: '제목 6', basedOn: 'body', next: 'body', para: { space: { before: 8000, after: 2000 }, keepWithNext: true }, marks: { bold: true, italic: true, size: 10000 } },
  code: { name: 'code', label: '코드', basedOn: 'body', para: { space: { before: 0, after: 0 } }, marks: { font: 'monospace', size: 9500 } },
};

const DEFAULT_NAMES = new Set(DEFAULT_STYLES.map((s) => s.name));

/** 정본이 쓰는 스타일 중 기본에 없고 덧붙인 스타일에 있는 것을 styles에 넣는다 */
export function addUsedStyles(q: QuireDoc): void {
  const used = new Set<string>();
  const visit = (paras: unknown) => {
    if (!Array.isArray(paras)) return;
    for (const b of paras) {
      const st = (b as QuireParagraph).p?.style;
      if (typeof st === 'string') used.add(st);
    }
  };
  for (const v of Object.values(q.stories)) visit(v);
  for (const name of used) if (!DEFAULT_NAMES.has(name) && EXTRA_STYLES[name] && !q.styles[name]) q.styles[name] = structuredClone(EXTRA_STYLES[name]);
}

/** 빈 정본 (본문은 넣을 블록, 없으면 빈 문단 하나) */
export function emptyQuire(body: Array<QuireParagraph | QuireTable>): QuireDoc {
  const q = quireFromText('\n');
  q.stories.body = body.length ? body : [{ p: {}, c: [] }];
  return q;
}

// ── 이미지 ─────────────────────────────────────────────

/** 이미지 크기 (px): PNG, JPEG, GIF, WebP(VP8X·VP8·VP8L). 모르면 null */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const be16 = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const be32 = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  const le16 = (i: number) => b[i]! | (b[i + 1]! << 8);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: be32(16), height: be32(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: le16(6), height: le16(8) };
  if (b.length > 30 && String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === 'RIFF' && String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'WEBP') {
    const kind = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (kind === 'VP8X') return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    if (kind === 'VP8 ') return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (kind === 'VP8L') {
      const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: 1 + (v & 0x3fff), height: 1 + ((v >>> 14) & 0x3fff) };
    }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1]!;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
        i += m === 0xff ? 1 : 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: be16(i + 7), height: be16(i + 5) };
      i += 2 + be16(i + 2);
    }
  }
  return null;
}

export function mimeOf(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x52 && b[8] === 0x57) return 'image/webp';
  return 'application/octet-stream';
}

/** data: URL → 바이트 (base64 또는 퍼센트 인코딩). 이미지가 아니면 null */
export function fromDataUrl(url: string): ImportedAsset | null {
  const m = /^data:(image\/[\w.+-]+)?((?:;[\w-]+=[^;,]*)*)(;base64)?,(.*)$/is.exec(url.trim());
  if (!m) return null;
  const data = m[4]!;
  let bytes: Uint8Array;
  try {
    if (m[3]) {
      const bin = atob(data.replace(/\s+/g, ''));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else bytes = new TextEncoder().encode(decodeURIComponent(data));
  } catch {
    return null;
  }
  return { bytes, type: m[1] ?? mimeOf(bytes) };
}

export function toDataUrl(a: ImportedAsset): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < a.bytes.length; i += step) bin += String.fromCharCode(...a.bytes.subarray(i, i + step));
  return `data:${a.type};base64,${btoa(bin)}`;
}

/** 본문 폭 (A4, 여백 72pt, 1/1000pt): 크기를 모르는 큰 이미지는 이 폭으로 줄인다 */
export const BODY_WIDTH = 451276;

/**
 * 받은 이미지 바이트를 자산으로: 자산 ID, 크기(1/1000pt, px × 750). 크기를 하나만 알면 비율로 채운다.
 */
export async function addAsset(assets: Map<string, ImportedAsset>, a: ImportedAsset, w?: number, h?: number): Promise<{ id: string; w?: number; h?: number }> {
  const id = await assetIdOf(a.bytes);
  assets.set(id, a);
  const size = imageSize(a.bytes);
  if (size && size.width > 0 && size.height > 0) {
    if (!w && !h) {
      w = size.width * 750;
      h = size.height * 750;
      if (w > BODY_WIDTH) {
        h = Math.round((h * BODY_WIDTH) / w);
        w = BODY_WIDTH;
      }
    } else if (w && !h) h = Math.round((w * size.height) / size.width);
    else if (h && !w) w = Math.round((h * size.width) / size.height);
  }
  return { id, w, h };
}

/** 표의 격자: 칸마다 그 자리가 주인인 셀의 스토리 (덮인 칸·빈 칸은 null). 덮인 칸을 건너뛰며 놓는다 (HTML 표와 같다) */
export function tableGrid(t: QuireTable['table']): Array<Array<string | null>> {
  const n = t.cols.length;
  const grid: Array<Array<string | null>> = t.rows.map(() => Array.from({ length: n }, () => null));
  const taken = new Set<string>();
  t.rows.forEach((row, y) => {
    let x = 0;
    for (const cell of row.cells) {
      while (taken.has(`${y},${x}`)) x++;
      if (x >= n) break;
      const [h, w] = cell.span ?? [1, 1];
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) taken.add(`${yy},${xx}`);
      grid[y]![x] = cell.story;
      x += w;
    }
  });
  return grid;
}
