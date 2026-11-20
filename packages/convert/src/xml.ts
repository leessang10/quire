/**
 * 작은 XML 파서·작성기 (15 §6.2): DOCX·HWPX용. 요소, 속성, 글, 엔티티, CDATA, 네임스페이스만.
 * 네임스페이스는 알려진 URI면 정해진 접두사로 이름을 바꾼다 (문서가 다른 접두사를 써도 'w:p'로 찾는다).
 */

export interface XNode {
  /** 접두사를 정규화한 이름 (예: w:p) */
  name: string;
  attrs: Record<string, string>;
  children: Array<XNode | string>;
}

/** 알려진 네임스페이스 → 정해진 접두사 */
export const NS: Record<string, string> = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  // HWPX (OWPML)
  hp: 'http://www.hancom.co.kr/hwpml/2011/paragraph',
  hs: 'http://www.hancom.co.kr/hwpml/2011/section',
  hh: 'http://www.hancom.co.kr/hwpml/2011/head',
  hc: 'http://www.hancom.co.kr/hwpml/2011/core',
};
const PREFIX_OF = new Map(Object.entries(NS).map(([p, u]) => [u, p]));

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENT[e] ?? all;
  });
}

/** 요소 중첩 상한 */
export const MAX_XML_DEPTH = 256;

/** XML → 뿌리 요소 */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [] };
  const stack: Array<{ node: XNode; ns: Map<string, string> }> = [{ node: root, ns: new Map() }];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const top = () => stack[stack.length - 1]!;
  const rename = (q: string, ns: Map<string, string>, isAttr: boolean): string => {
    const i = q.indexOf(':');
    const pre = i < 0 ? '' : q.slice(0, i);
    const local = i < 0 ? q : q.slice(i + 1);
    if (isAttr && i < 0) return local; // 접두사 없는 속성은 네임스페이스 없음
    const uri = ns.get(pre);
    const p = uri ? PREFIX_OF.get(uri) : undefined;
    if (p !== undefined) return `${p}:${local}`;
    return q;
  };
  while ((m = re.exec(xml))) {
    if (m.index > last) {
      const t = xml.slice(last, m.index);
      top().node.children.push(decode(t));
    }
    last = re.lastIndex;
    if (m[1] !== undefined) {
      top().node.children.push(m[1]);
      continue;
    }
    if (m[2]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (!m[3]) continue;
    const raw: Record<string, string> = {};
    const ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[4] ?? ''))) raw[a[1]!] = decode(a[2] ?? a[3] ?? '');
    const ns = new Map(top().ns);
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'xmlns') ns.set('', v);
      else if (k.startsWith('xmlns:')) ns.set(k.slice(6), v);
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (k !== 'xmlns' && !k.startsWith('xmlns:')) attrs[rename(k, ns, true)] = v;
    const node: XNode = { name: rename(m[3], ns, false), attrs, children: [] };
    top().node.children.push(node);
    if (!m[5]) {
      stack.push({ node, ns });
      // 깊은 중첩은 읽는 쪽의 재귀가 스택을 넘긴다 (16 §6). 실제 문서는 수십 단계
      if (stack.length > MAX_XML_DEPTH) throw new Error(`xml: elements nested too deeply (> ${MAX_XML_DEPTH})`);
    }
  }
  const el = root.children.find((c): c is XNode => typeof c !== 'string');
  return el ?? root;
}

/** 자식 요소 */
export function kids(n: XNode | undefined, name?: string): XNode[] {
  if (!n) return [];
  return n.children.filter((c): c is XNode => typeof c !== 'string' && (name === undefined || c.name === name));
}

export function kid(n: XNode | undefined, name: string): XNode | undefined {
  return n?.children.find((c): c is XNode => typeof c !== 'string' && c.name === name);
}

/** 경로의 자손 (a/b/c) */
export function path(n: XNode | undefined, p: string): XNode | undefined {
  let cur = n;
  for (const part of p.split('/')) cur = kid(cur, part);
  return cur;
}

/** 모든 자손 요소 (깊이 우선) */
export function* descendants(n: XNode, name?: string): Generator<XNode> {
  for (const c of n.children) {
    if (typeof c === 'string') continue;
    if (name === undefined || c.name === name) yield c;
    yield* descendants(c, name);
  }
}

export function textOf(n: XNode | string): string {
  return typeof n === 'string' ? n : n.children.map(textOf).join('');
}

// ── 작성 ─────────────────────────────────────────────

export const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** 요소 하나 (자식이 없으면 닫힌 태그). 속성 값이 undefined면 뺀다 */
export function x(name: string, attrs: Record<string, string | number | boolean | undefined> | null = null, ...children: Array<string | false | null | undefined>): string {
  let a = '';
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) a += ` ${k}="${escXml(String(v))}"`;
  const body = children.filter((c): c is string => !!c).join('');
  return body ? `<${name}${a}>${body}</${name}>` : `<${name}${a}/>`;
}

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
