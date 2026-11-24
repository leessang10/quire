/**
 * `.quire` 파일 (07 §2–3): ZIP 안에 mimetype, manifest.json, document.json(정본), history/crdt.bin(선택).
 *
 * 여는 규칙
 * 1. mimetype·manifest 확인. formatVersion이 엔진보다 높으면 읽기 전용.
 * 2. document.json 스키마 확인 → 마이그레이션.
 * 3. history/crdt.bin(협업 이력, CRDT 스냅샷)은 여기서 읽지 않고 바이트 그대로 돌려준다 (`history`). 이력을 확인하고 되살리는
 *    일(그 화면 상태가 document.json과 같은지, 다르면 버림)은 협업 쪽이 한다 (`@quiredoc/sync`의 `restoreHistory`, 19 §4.1).
 *    그래서 이 모듈은 CRDT 라이브러리 없이 돈다: 저장·불러오기만 하는 앱에 Loro가 묶이지 않는다.
 */
import type { Doc } from './doc';
import type { Document } from './document';
import { canonicalJson, migrateQuire, quireFromDoc, quireFromDocument, quireFromText, sha256Hex, stateHash, textFromQuire, type QuireDoc } from './canonical';
import { readZip, writeZip, type ZipEntry } from './zip';

export const MIMETYPE = 'application/vnd.quire';
export const FORMAT_VERSION = 1;
export const GENERATOR = 'quire-engine/0.0.0';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface Manifest {
  format: 'quire';
  formatVersion: number;
  schemaVersion: number;
  generator: string;
  files: Record<string, { sha256: string; stateHash?: string }>;
}

/** 자산 하나 (11 §2.2): ID = 내용 SHA-256 앞 32자 (16진) */
export interface QuireAsset {
  id: string;
  mime: string;
  bytes: Uint8Array;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const MIME: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

/** 자산 ID: 내용 SHA-256의 앞 32자 */
export async function assetIdOf(bytes: Uint8Array): Promise<string> {
  return (await sha256Hex(bytes)).slice(0, 32);
}

/** 문서가 가리키는 자산 ID들 (Document면 모든 스토리) */
export function assetIdsOf(doc: Doc | Document): string[] {
  const ids = new Set<string>();
  const docs = 'body' in doc ? [doc.body, ...doc.storyIds().map((id) => doc.story(id))] : [doc];
  for (const d of docs) for (const p of d.paragraphs()) if (p.objs) for (const o of p.objs.values()) if (o.asset) ids.add(o.asset);
  return [...ids].sort();
}

/**
 * 저장: 문서(또는 텍스트)로 document.json을 만든다. `history`(협업 이력 CRDT 스냅샷 바이트)를 주면 history/crdt.bin으로 넣고
 * 그 정본 해시를 manifest에 적는다 (열 때 이력이 문서와 같은지 확인하는 데 쓴다). 이력을 만드는 것은 협업 쪽
 * (`packQuireWithHistory`)이고, 여기서는 바이트를 그대로 싣는다
 */
export async function packQuire(
  src: ({ text: string } | { doc: Doc } | { document: Document }) & { assets?: readonly QuireAsset[]; history?: Uint8Array },
): Promise<Uint8Array<ArrayBuffer>> {
  // 서식이 있으면 함께 (10, 07 §4)
  const doc =
    'document' in src ? quireFromDocument(src.document)
    : 'doc' in src ? quireFromDoc(src.doc)
    : quireFromText(src.text);
  const json = encoder.encode(canonicalJson(doc));
  const files: Manifest['files'] = { 'document.json': { sha256: await sha256Hex(json) } };
  const entries: ZipEntry[] = [
    { name: 'mimetype', data: encoder.encode(MIMETYPE) },
    { name: 'manifest.json', data: new Uint8Array(), deflate: true },
    { name: 'document.json', data: json, deflate: true },
  ];
  // 자산: assets/<ID>.<확장자> (07 §2). 이미 압축된 형식이라 deflate하지 않는다
  for (const a of [...(src.assets ?? [])].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const name = `assets/${a.id}.${EXT[a.mime] ?? 'bin'}`;
    files[name] = { sha256: await sha256Hex(a.bytes) };
    entries.push({ name, data: a.bytes });
  }
  if (src.history) {
    files['history/crdt.bin'] = { sha256: await sha256Hex(src.history), stateHash: await stateHash(doc) };
    entries.push({ name: 'history/crdt.bin', data: src.history, deflate: true });
  }
  const manifest: Manifest = { format: 'quire', formatVersion: FORMAT_VERSION, schemaVersion: doc.version, generator: GENERATOR, files };
  entries[1]!.data = encoder.encode(canonicalJson(manifest));
  return writeZip(entries);
}

export interface OpenedQuire {
  doc: QuireDoc;
  /** 화면 텍스트 (끝 ¶ 포함) */
  text: string;
  /** 들어 있는 자산 (assets/) */
  assets: QuireAsset[];
  /**
   * history/crdt.bin 바이트 (없으면 null). **확인하지 않은 값**이다: 협업 이력으로 쓰려면 `restoreHistory`(@quiredoc/sync)로
   * 문서와 같은 상태인지 확인한다. 다시 저장할 때 `packQuire({ ..., history })`로 그대로 넘기면 이력을 잃지 않는다
   */
  history: Uint8Array | null;
  readOnly: boolean;
  /** manifest 해시가 다른 항목, 버린 자산 등 */
  notes: string[];
}

/** JSON 항목 읽기: 문법 오류는 어느 항목인지 밝힌다 (16 §6) */
function parseJson(bytes: Uint8Array, name: string): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (e) {
    throw new Error(`.quire: ${name} is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
}

export async function openQuire(bytes: Uint8Array): Promise<OpenedQuire> {
  const entries = await readZip(bytes);
  const get = (name: string) => entries.find((e) => e.name === name)?.data;
  if (entries[0]?.name !== 'mimetype' || entries[0].method !== 0 || decoder.decode(entries[0].data) !== MIMETYPE) throw new Error('.quire: mimetype must be the first entry');
  const m = get('manifest.json');
  if (!m) throw new Error('.quire: manifest.json is missing');
  const manifest = parseJson(m, 'manifest.json') as Manifest;
  if (manifest.format !== 'quire' || typeof manifest.formatVersion !== 'number') throw new Error('.quire: bad manifest');
  const notes: string[] = [];
  const j = get('document.json');
  if (!j) throw new Error('.quire: document.json is missing');
  for (const [name, info] of Object.entries(manifest.files ?? {})) {
    const data = get(name);
    if (data && info.sha256 && (await sha256Hex(data)) !== info.sha256) notes.push(`${name}: manifest hash differs (edited outside Quire?)`);
  }
  const { doc, readOnly: newerSchema } = migrateQuire(parseJson(j, 'document.json'));
  const readOnly = newerSchema || manifest.formatVersion > FORMAT_VERSION;
  const text = textFromQuire(doc);
  const history = get('history/crdt.bin') ?? null;
  const assets: QuireAsset[] = [];
  for (const e of entries) {
    const am = /^assets\/([0-9a-f]{32})\.(\w+)$/.exec(e.name);
    if (!am) continue;
    if ((await assetIdOf(e.data)) !== am[1]) {
      notes.push(`${e.name}: content does not match its name; dropped`);
      continue;
    }
    assets.push({ id: am[1]!, mime: MIME[am[2]!] ?? 'application/octet-stream', bytes: e.data });
  }
  return { doc, text, history, readOnly, notes, assets };
}
