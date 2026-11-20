/**
 * Markdown (GFM, 15 §6.5). 내보내기: 정본 → 제목, 강조(굵게·기울임·취소선), 목록(중첩), 링크, 이미지(자산 경로), 표, 각주, 인용,
 * 코드(코드 스타일 문단 → 펜스). Markdown이 담지 못하는 것(밑줄, 크기·색, 정렬·간격, 병합 셀)은 버린다.
 * 가져오기: 블록 → 인라인 두 단계의 자체 파서 (GFM 명세의 일부).
 */
import { defaultListDef, noteStoryId, type ListDef, type MarkSet, type ObjAttrs, type ParaAttrs } from '@quire/model';
import type { QuireDoc, QuireParagraph, QuireRun, QuireTable } from '@quire/sync';
import { BODY_WIDTH, Report, addAsset, addUsedStyles, emptyQuire, fromDataUrl, tableGrid, type ImportResult, type ImportedAsset } from './common';

const isTable = (b: QuireParagraph | QuireTable): b is QuireTable => 'table' in b;

export interface MarkdownExportOptions {
  /** 이미지 자산의 경로 (기본: assets/<ID>) */
  assetPath?: (id: string) => string;
}

// ── 내보내기 ─────────────────────────────────────────────

/** 글자 탈출: 인라인 문법 글자 */
function escText(s: string, inTable: boolean): string {
  let out = s.replace(/[\\`*_[\]<>~]/g, (c) => `\\${c}`);
  if (inTable) out = out.replace(/\|/g, '\\|');
  return out;
}

/** 문단 첫머리의 블록 문법 탈출 (#, >, 목록 기호, 번호.) */
function escStart(s: string): string {
  return s.replace(/^(\s*)([#>+-]|\d+[.)])/, (_, sp: string, m: string) => `${sp}${m.length > 1 ? `${m.slice(0, -1)}\\${m.slice(-1)}` : `\\${m}`}`);
}

interface MdNotes {
  order: string[];
  num(id: string): number;
}

/** 런 → Markdown 인라인. 같은 링크·강조가 이어진 런은 한 번만 감싼다 */
function inlineMd(runs: QuireRun[], notes: MdNotes, assetPath: (id: string) => string, inTable: boolean): string {
  type Piece = { text: string; m: MarkSet; atom: boolean };
  const pieces: Piece[] = [];
  for (const r of runs) {
    const m = r.m ?? {};
    if (r.img) {
      const o = r.img as ObjAttrs;
      if (o.kind === 'note' && o.id) pieces.push({ text: `[^${notes.num(o.id)}]`, m: {}, atom: true });
      else if (o.kind === 'image') pieces.push({ text: `![${escText(o.alt ?? '', inTable)}](${o.asset ? assetPath(o.asset) : ''})`, m: { link: m.link }, atom: true });
      continue;
    }
    if (r.t) pieces.push({ text: escText(r.t, inTable), m, atom: false });
  }
  // 강조 감싸기: 굵게 → 기울임 → 취소선 순으로 바깥에서 안으로 (연속 구간마다)
  const wrap = (list: Piece[], keys: Array<['bold' | 'italic' | 'strike', string]>): string => {
    if (!keys.length) return list.map((p) => p.text).join('');
    const [[key, mark], ...rest] = keys;
    let out = '';
    for (let i = 0; i < list.length; ) {
      const on = !!list[i]!.m[key] && !list[i]!.atom;
      let j = i + 1;
      while (j < list.length && (!!list[j]!.m[key] && !list[j]!.atom) === on) j++;
      const inner = wrap(list.slice(i, j), rest);
      if (on) {
        // 강조 안 앞뒤 공백은 밖으로 (CommonMark 좌우 규칙)
        const lead = /^\s*/.exec(inner)![0];
        const trail = /\s*$/.exec(inner)![0];
        const core = inner.slice(lead.length, inner.length - trail.length);
        out += core ? `${lead}${mark}${core}${mark}${trail}` : inner;
      } else out += inner;
      i = j;
    }
    return out;
  };
  // 링크: 같은 주소가 이어진 구간
  let out = '';
  for (let i = 0; i < pieces.length; ) {
    const link = pieces[i]!.m.link;
    let j = i + 1;
    while (j < pieces.length && pieces[j]!.m.link === link) j++;
    const inner = wrap(pieces.slice(i, j), [
      ['bold', '**'],
      ['italic', '*'],
      ['strike', '~~'],
    ]);
    out += link ? `[${inner}](${link.replace(/[()\s]/g, encodeURIComponent)})` : inner;
    i = j;
  }
  return out;
}

const HEADING = /^h([1-6])$/;

/** 정본 → Markdown */
export function exportMarkdown(q: QuireDoc, opts: MarkdownExportOptions = {}): string {
  const assetPath = opts.assetPath ?? ((id: string) => `assets/${id}`);
  const lists = (q.settings.lists ?? {}) as Record<string, ListDef>;
  const order: string[] = [];
  const notes: MdNotes = {
    order,
    num(id) {
      let k = order.indexOf(id);
      if (k < 0) k = order.push(id) - 1;
      return k + 1;
    },
  };
  const story = (name: string) => (Array.isArray(q.stories[name]) ? (q.stories[name] as Array<QuireParagraph | QuireTable>) : []);
  const plain = (b: QuireParagraph) => (b.c ?? []).map((r) => r.t ?? '').join('');

  const blocks = (list: Array<QuireParagraph | QuireTable>): string[] => {
    /** 블록 묶음 (빈 줄로 나눈다). 목록 항목·코드 줄은 앞 묶음에 붙는다 */
    const groups: string[] = [];
    let listGroup: string[] | null = null;
    /** 수준별 번호 */
    const counters: number[] = [];
    let code: string[] | null = null;
    const flush = () => {
      if (listGroup) groups.push(listGroup.join('\n'));
      if (code) groups.push(['```', ...code, '```'].join('\n'));
      listGroup = null;
      code = null;
    };
    for (const b of list) {
      if (isTable(b)) {
        flush();
        groups.push(tableMd(b));
        continue;
      }
      const p = b.p as ParaAttrs;
      if (p.style === 'code' && !p.list) {
        if (!code) flush();
        code ??= [];
        code.push(plain(b));
        continue;
      }
      if (code) flush();
      const text = inlineMd(b.c ?? [], notes, assetPath, false);
      if (p.list) {
        if (!listGroup) {
          flush();
          listGroup = [];
          counters.length = 0;
        }
        const level = p.list.level;
        counters.length = level + 1;
        counters[level] = (counters[level] ?? 0) + 1;
        const bullet = lists[p.list.id]?.kind === 'bullet';
        listGroup.push(`${'    '.repeat(level)}${bullet ? '-' : `${counters[level]}.`} ${escStart(text)}`);
        continue;
      }
      flush();
      if (!text.trim()) continue; // 빈 문단은 Markdown에 없다
      const h = HEADING.exec(p.style ?? '');
      if (h) groups.push(`${'#'.repeat(Number(h[1]))} ${text}`);
      else if (p.style === 'quote') groups.push(`> ${escStart(text)}`);
      else groups.push(escStart(text));
    }
    flush();
    return groups;
  };

  const cellText = (name: string) =>
    story(name)
      .filter((b): b is QuireParagraph => !isTable(b))
      .map((b) => inlineMd(b.c ?? [], notes, assetPath, true))
      .filter(Boolean)
      .join('<br>'); // 칸 안 문단 (GFM 표 칸은 한 줄)

  const tableMd = (b: QuireTable): string => {
    const n = b.table.cols.length;
    // 병합은 담지 못한다: 주인 칸에 글, 덮인 칸은 비운다
    const rows = tableGrid(b.table).map((r) => `| ${r.map((name) => (name ? cellText(name) : '')).join(' | ')} |`);
    if (!rows.length) return '';
    return [rows[0], `|${' --- |'.repeat(n)}`, ...rows.slice(1)].join('\n');
  };

  const out = blocks(q.stories.body);
  // 각주 정의 (참조 순서). 둘째 문단부터 네 칸 들여쓴다
  for (let k = 0; k < order.length; k++) {
    const parts = blocks(story(noteStoryId(order[k]!)));
    out.push(`[^${k + 1}]: ${(parts[0] ?? '').replace(/\n/g, '\n    ')}${parts.slice(1).map((s) => `\n\n    ${s.replace(/\n/g, '\n    ')}`).join('')}`);
  }
  return `${out.join('\n\n')}\n`;
}

// ── 가져오기: 인라인 ─────────────────────────────────────

interface InlineCtx {
  /** 각주 표지 → 각주 ID */
  noteId(label: string): string | null;
  image(alt: string, src: string, m: MarkSet): QuireRun | null;
}

const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

/** 닫는 구분자 위치 (탈출·코드 안 제외, 앞 글자가 공백이 아님) */
function findClose(s: string, from: number, delim: string): number {
  for (let i = from; i <= s.length - delim.length; i++) {
    const c = s[i]!;
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) i = end + run.length - 1;
      continue;
    }
    if (s.startsWith(delim, i) && i > from && !/\s/.test(s[i - 1]!)) {
      // 한 글자 구분자는 두 글자 구분자의 일부가 아니어야 한다
      if (delim.length === 1 && (s[i + 1] === delim || s[i - 1] === delim)) continue;
      if (delim === '_' && /\w/.test(s[i + 1] ?? '')) continue;
      return i;
    }
  }
  return -1;
}

/** 대괄호 짝 ([ … ]) 의 닫는 위치 */
function matchBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

/** ( 주소 "제목" ) 를 읽는다 */
function readDest(s: string, at: number): { url: string; end: number } | null {
  if (s[at] !== '(') return null;
  let i = at + 1;
  while (s[i] === ' ') i++;
  let url = '';
  if (s[i] === '<') {
    const e = s.indexOf('>', i);
    if (e < 0) return null;
    url = s.slice(i + 1, e);
    i = e + 1;
  } else {
    let depth = 0;
    for (; i < s.length; i++) {
      const c = s[i]!;
      if (c === '\\' && i + 1 < s.length) {
        url += s[++i];
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') {
        if (depth === 0) break;
        depth--;
      }
      if (c === ' ') break;
      url += c;
    }
  }
  while (s[i] === ' ') i++;
  if (s[i] === '"' || s[i] === "'") {
    const e = s.indexOf(s[i]!, i + 1);
    if (e < 0) return null;
    i = e + 1;
    while (s[i] === ' ') i++;
  }
  if (s[i] !== ')') return null;
  return { url, end: i + 1 };
}

function parseInline(s: string, m: MarkSet, ctx: InlineCtx, out: QuireRun[] = []): QuireRun[] {
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const last = out[out.length - 1];
    if (last && last.t !== undefined && JSON.stringify(last.m ?? {}) === JSON.stringify(m)) last.t += buf;
    else out.push({ t: buf, ...(Object.keys(m).length ? { m: { ...m } } : {}) });
    buf = '';
  };
  const emph = (i: number, delim: string, add: MarkSet): number => {
    const close = findClose(s, i + delim.length, delim);
    if (close < 0 || /\s/.test(s[i + delim.length] ?? ' ')) return -1;
    flush();
    parseInline(s.slice(i + delim.length, close), { ...m, ...add }, ctx, out);
    return close + delim.length;
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) {
        flush();
        let code = s.slice(i + run.length, end);
        if (code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        const cm: MarkSet = { ...m, font: 'monospace' };
        out.push({ t: code, m: cm });
        i = end + run.length;
        continue;
      }
      buf += run;
      i += run.length;
      continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      const close = matchBracket(s, i + 1);
      const dest = close > 0 ? readDest(s, close + 1) : null;
      if (dest) {
        flush();
        const run = ctx.image(s.slice(i + 2, close).replace(/\\(.)/g, '$1'), dest.url, m);
        if (run) out.push(run);
        i = dest.end;
        continue;
      }
    }
    if (c === '[') {
      const close = matchBracket(s, i);
      if (close > 0 && s[i + 1] === '^') {
        const id = ctx.noteId(s.slice(i + 2, close));
        if (id) {
          flush();
          out.push({ img: { id, kind: 'note' } });
          i = close + 1;
          continue;
        }
      }
      const dest = close > 0 ? readDest(s, close + 1) : null;
      if (dest) {
        flush();
        parseInline(s.slice(i + 1, close), { ...m, link: dest.url }, ctx, out);
        i = dest.end;
        continue;
      }
    }
    if (c === '<') {
      const auto = /^<((?:https?|mailto|ftp):[^\s<>]+)>/i.exec(s.slice(i));
      if (auto) {
        flush();
        parseInline(auto[1]!.replace(/[\\`*_[\]<>~]/g, '\\$&'), { ...m, link: auto[1] }, ctx, out);
        i += auto[0].length;
        continue;
      }
      const tag = /^<(\/?)(u|ins|b|strong|i|em|s|del|sup|sub|br)\s*\/?>/i.exec(s.slice(i));
      if (tag) {
        const name = tag[2]!.toLowerCase();
        if (name === 'br') {
          buf += ' ';
          i += tag[0].length;
          continue;
        }
        if (!tag[1]) {
          const end = s.toLowerCase().indexOf(`</${name}>`, i + tag[0].length);
          if (end > 0) {
            flush();
            const add: MarkSet =
              name === 'u' || name === 'ins' ? { underline: true } : name === 'b' || name === 'strong' ? { bold: true } : name === 'i' || name === 'em' ? { italic: true } : name === 's' || name === 'del' ? { strike: true } : { script: name as 'sup' | 'sub' };
            parseInline(s.slice(i + tag[0].length, end), { ...m, ...add }, ctx, out);
            i = end + name.length + 3;
            continue;
          }
        }
      }
    }
    if (c === '*' || c === '_') {
      const triple = c.repeat(3);
      if (s.startsWith(triple, i)) {
        const j = emph(i, triple, { bold: true, italic: true });
        if (j > 0) {
          i = j;
          continue;
        }
      }
      if (s.startsWith(c + c, i)) {
        const j = emph(i, c + c, { bold: true });
        if (j > 0) {
          i = j;
          continue;
        }
      } else if (!(c === '_' && /\w/.test(s[i - 1] ?? ''))) {
        const j = emph(i, c, { italic: true });
        if (j > 0) {
          i = j;
          continue;
        }
      }
    }
    if (c === '~' && s[i + 1] === '~') {
      const j = emph(i, '~~', { strike: true });
      if (j > 0) {
        i = j;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// ── 가져오기: 블록 ─────────────────────────────────────

interface MdBlock {
  kind: 'para' | 'heading' | 'quote' | 'code' | 'item' | 'table';
  text: string;
  level?: number;
  /** 목록: 종류, 수준 */
  list?: { kind: 'bullet' | 'number'; level: number; group: number };
  rows?: string[][];
}

const ITEM = /^( *)([-+*]|\d{1,9}[.)])( +|$)(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const DELIM = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;
const NOTE_DEF = /^ {0,3}\[\^([^\]]+)\]: ?(.*)$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** 줄 → 블록. 각주 정의는 따로 모은다 */
function parseBlocks(lines: string[], report: Report, notes: Map<string, string[]>): MdBlock[] {
  const out: MdBlock[] = [];
  let para: string[] | null = null;
  /** 지금 목록: 수준별 들여쓰기 */
  let listIndents: number[] = [];
  let group = 0;
  let lastItem: MdBlock | null = null;
  const endPara = () => {
    if (para) out.push({ kind: 'para', text: para.join(' ') });
    para = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      endPara();
      lastItem = null;
      // 목록은 빈 줄 뒤에도 다음 항목이 오면 이어진다
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      endPara();
      lastItem = null;
      const mark = fence[1]!;
      const body: string[] = [];
      for (i++; i < lines.length; i++) {
        if (new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`).test(lines[i]!)) break;
        body.push(lines[i]!);
      }
      for (const b of body.length ? body : ['']) out.push({ kind: 'code', text: b });
      continue;
    }
    const def = NOTE_DEF.exec(line);
    if (def) {
      endPara();
      lastItem = null;
      const parts = [def[2]!];
      // 이어지는 줄: 들여쓴 줄 (빈 줄 뒤에도), 또는 바로 이어진 줄
      for (; i + 1 < lines.length; i++) {
        const nx = lines[i + 1]!;
        if (/^( {4}|\t)/.test(nx)) parts.push(nx.replace(/^( {4}|\t)/, ''));
        else if (!nx.trim() && i + 2 < lines.length && /^( {4}|\t)/.test(lines[i + 2]!)) parts.push('');
        else if (nx.trim() && parts[parts.length - 1] !== '' && !NOTE_DEF.exec(nx) && !ATX.exec(nx) && !ITEM.exec(nx)) parts.push(nx);
        else break;
      }
      notes.set(def[1]!, parts);
      continue;
    }
    const h = ATX.exec(line);
    if (h) {
      endPara();
      lastItem = null;
      out.push({ kind: 'heading', level: h[1]!.length, text: h[2] ?? '' });
      continue;
    }
    if (RULE.test(line) && !(para && /^ {0,3}-+\s*$/.test(line))) {
      endPara();
      lastItem = null;
      report.drop('가로줄');
      continue;
    }
    // 세텍스트 제목 (=== / ---)
    if (para && /^ {0,3}(=+|-+)\s*$/.test(line)) {
      out.push({ kind: 'heading', level: line.trim()[0] === '=' ? 1 : 2, text: para.join(' ') });
      para = null;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      endPara();
      lastItem = null;
      const q: string[] = [];
      for (; i < lines.length && /^ {0,3}>/.test(lines[i]!); i++) q.push(lines[i]!.replace(/^ {0,3}> ?/, ''));
      i--;
      // 인용 안은 문단들 (빈 줄로 나눔)
      let cur: string[] = [];
      for (const l of [...q, '']) {
        if (l.trim()) cur.push(l.replace(/^#{1,6}\s+/, ''));
        else if (cur.length) {
          out.push({ kind: 'quote', text: cur.join(' ') });
          cur = [];
        }
      }
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && DELIM.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
      endPara();
      lastItem = null;
      const rows = [splitRow(line)];
      for (i += 2; i < lines.length && lines[i]!.trim() && lines[i]!.includes('|'); i++) rows.push(splitRow(lines[i]!));
      i--;
      out.push({ kind: 'table', text: '', rows });
      continue;
    }
    const item = ITEM.exec(line);
    if (item && !(para && !lastItem && /^\d/.test(item[2]!) && item[2] !== '1.' && item[2] !== '1)')) {
      endPara();
      const indent = item[1]!.length;
      if (!listIndents.length || !lastItemOrList(out)) {
        listIndents = [];
        group++;
      }
      while (listIndents.length && indent < listIndents[listIndents.length - 1]!) listIndents.pop();
      if (!listIndents.length || indent > listIndents[listIndents.length - 1]!) {
        if (listIndents.length && indent - listIndents[listIndents.length - 1]! < 2) {
          // 들여쓰기가 모자라면 같은 수준
        } else listIndents.push(indent);
      }
      const level = Math.max(0, listIndents.length - 1);
      lastItem = { kind: 'item', text: item[4]!, list: { kind: /^\d/.test(item[2]!) ? 'number' : 'bullet', level, group } };
      out.push(lastItem);
      continue;
    }
    if (lastItem && para === null) {
      // 항목의 이어지는 줄 (게으른 이어짐)
      lastItem.text += ` ${line.trim()}`;
      continue;
    }
    if (para) para.push(line.trim());
    else para = [line.trim()];
    listIndents = listIndents.length && lastItemOrList(out) ? listIndents : [];
  }
  endPara();
  return out;
}

/** 블록 열의 끝이 목록 항목인가 (목록이 이어지는지) */
function lastItemOrList(out: MdBlock[]): boolean {
  return out.length > 0 && out[out.length - 1]!.kind === 'item';
}

export interface MarkdownImportOptions {
  /** 상대 경로 이미지의 바이트 (예: 함께 고른 파일들) */
  resolve?: (src: string) => Promise<ImportedAsset | null>;
}

/** Markdown → 정본 */
export async function importMarkdown(md: string, opts: MarkdownImportOptions = {}): Promise<ImportResult> {
  const report = new Report();
  const assets = new Map<string, ImportedAsset>();
  const lines = md.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const noteDefs = new Map<string, string[]>();
  const blocks = parseBlocks(lines, report, noteDefs);

  // 각주: 정의가 있는 표지만 (참조 순서로 ID)
  const noteIds = new Map<string, string>();
  const ctx: InlineCtx = {
    noteId(label) {
      if (!noteDefs.has(label)) return null;
      let id = noteIds.get(label);
      if (!id) {
        id = `n${noteIds.size + 1}`;
        noteIds.set(label, id);
      }
      return id;
    },
    image: () => null,
  };
  // 이미지는 비동기라 자리표시 런으로 두었다가 채운다
  const pendings: Array<{ run: QuireRun; alt: string; src: string }> = [];
  ctx.image = (alt, src, m) => {
    const run: QuireRun = { img: { kind: 'image', ...(alt ? { alt } : {}) }, ...(m.link ? { m: { link: m.link } } : {}) };
    pendings.push({ run, alt, src });
    return run;
  };

  const lists = new Map<string, ListDef>();
  const toParas = (bs: MdBlock[], prefix: string): Array<QuireParagraph | QuireTable> => {
    const out: Array<QuireParagraph | QuireTable> = [];
    let tk = 0;
    for (const b of bs) {
      if (b.kind === 'table') {
        tk++;
        const n = Math.max(...b.rows!.map((r) => r.length));
        const rows: QuireTable['table']['rows'] = [];
        b.rows!.forEach((r, y) => {
          const cells: QuireTable['table']['rows'][0]['cells'] = [];
          for (let x = 0; x < n; x++) {
            const name = `${prefix}t${tk}.r${y + 1}c${x + 1}`;
            // 칸 안 <br>은 문단 나눔
            stories[name] = (r[x] ?? '').split(/(?<!\\)<br\s*\/?>/i).map((part) => ({ p: {}, c: parseInline(part.trim(), {}, ctx) }));
            cells.push({ story: name });
          }
          rows.push({ cells, ...(y === 0 ? { header: true as const } : {}) });
        });
        out.push({ table: { cols: Array.from({ length: n }, () => Math.floor(BODY_WIDTH / n)), rows } });
        continue;
      }
      const p: Record<string, unknown> = {};
      if (b.kind === 'heading') p.style = `h${b.level}`;
      if (b.kind === 'quote') p.style = 'quote';
      if (b.kind === 'code') {
        p.style = 'code';
        out.push({ p, c: b.text ? [{ t: b.text }] : [] });
        continue;
      }
      if (b.kind === 'item') {
        const id = `${prefix}m${b.list!.group}${b.list!.kind[0]}`;
        if (!lists.has(id)) lists.set(id, defaultListDef(id, b.list!.kind));
        p.list = { id, level: b.list!.level };
      }
      out.push({ p, c: parseInline(b.text.trim(), {}, ctx) });
    }
    return out;
  };
  const stories: Record<string, unknown> = {};
  const body = toParas(blocks, '');
  // 각주 내용 (참조된 것만)
  for (const [label, id] of [...noteIds]) {
    const parts = noteDefs.get(label)!;
    stories[noteStoryId(id)] = toParas(parseBlocks(parts, report, new Map()), `${id}.`);
  }
  // 참조가 각주 안에서 처음 나온 각주도 (위 반복 중에 늘었을 수 있다)
  for (const [label, id] of noteIds) if (!stories[noteStoryId(id)]) stories[noteStoryId(id)] = toParas(parseBlocks(noteDefs.get(label)!, report, new Map()), `${id}.`);
  for (const label of noteDefs.keys()) if (!noteIds.has(label)) report.drop('참조 없는 각주');

  // 이미지: data URL → 자산, 자산 ID 경로 → 그 자산, 상대 경로 → resolve, 나머지는 대체 텍스트
  let imgSeq = 0;
  for (const pd of pendings) {
    const img = pd.run.img!;
    img.id = `img${++imgSeq}`;
    const data = pd.src.startsWith('data:') ? fromDataUrl(pd.src) : null;
    const bytes = data ?? (opts.resolve && !/^[a-z]+:/i.test(pd.src) ? await opts.resolve(pd.src).catch(() => null) : null);
    if (bytes) {
      const { id, w, h } = await addAsset(assets, bytes);
      img.asset = id;
      if (w) img.w = w;
      if (h) img.h = h;
      continue;
    }
    const known = /(?:^|\/)([0-9a-f]{32})(?:\.\w+)?$/.exec(pd.src);
    if (known) {
      img.asset = known[1];
      continue;
    }
    // 담을 수 없는 이미지: 대체 텍스트로
    report.drop('이미지 (외부 주소)');
    delete pd.run.img;
    pd.run.t = pd.alt || pd.src;
  }

  const q = emptyQuire(body);
  Object.assign(q.stories as Record<string, unknown>, stories);
  if (lists.size) q.settings.lists = Object.fromEntries(lists);
  // 런이 비어 있는 이미지 런(대체 텍스트도 없음) 정리
  for (const v of Object.values(q.stories))
    if (Array.isArray(v)) for (const b of v as QuireParagraph[]) if (b.c) b.c = b.c.filter((r) => r.img || r.t);
  addUsedStyles(q);
  return { doc: q, assets, report };
}
