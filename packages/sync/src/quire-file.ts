/**
 * `.quire` 파일 (07 §2–3): ZIP 안에 mimetype, manifest.json, document.json(정본), history/crdt.bin(선택).
 *
 * 여는 규칙
 * 1. mimetype·manifest 확인. formatVersion이 엔진보다 높으면 읽기 전용.
 * 2. document.json 스키마 확인 → 마이그레이션.
 * 3. crdt.bin이 있고 그 화면 상태의 정본 해시가 document.json의 정본 해시와 같으면 CRDT로 연다 (이력·협업 연속성 유지).
 *    다르면(외부 도구가 JSON만 고친 경우) crdt.bin을 버리고 document.json에서 새로 만든다.
 */
import type { LoroDoc } from 'loro-crdt';
import type { Doc } from '@quire/model';
import { canonicalJson, docFromQuire, migrateQuire, quireFromDoc, quireFromText, sha256Hex, stateHash, textFromQuire, type QuireDoc } from './canonical';
import { docFromLoro, newLoro } from './shape';
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

/**
 * 저장: 화면 텍스트로 document.json을 만들고, loro를 주면 그 스냅샷을 history/crdt.bin으로 넣는다.
 * loro를 주면 text는 loro의 화면 텍스트를 쓴다.
 */
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

/** 문서가 가리키는 자산 ID들 */
export function assetIdsOf(doc: Doc): string[] {
  const ids = new Set<string>();
  for (const p of doc.paragraphs()) if (p.objs) for (const o of p.objs.values()) if (o.asset) ids.add(o.asset);
  return [...ids].sort();
}

export async function packQuire(
  src: ({ text: string } | { loro: LoroDoc } | { doc: Doc }) & { assets?: readonly QuireAsset[] },
): Promise<Uint8Array<ArrayBuffer>> {
  // 서식이 있으면 함께 (10, 07 §4)
  const doc = 'loro' in src ? quireFromDoc(docFromLoro(src.loro)) : 'doc' in src ? quireFromDoc(src.doc) : quireFromText(src.text);
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
  if ('loro' in src) {
    const crdt = src.loro.export({ mode: 'snapshot' });
    files['history/crdt.bin'] = { sha256: await sha256Hex(crdt), stateHash: await stateHash(doc) };
    entries.push({ name: 'history/crdt.bin', data: crdt, deflate: true });
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
  /** 이력을 쓸 수 있으면 CRDT 스냅샷, 아니면 null */
  crdt: Uint8Array | null;
  readOnly: boolean;
  /** crdt.bin을 버린 이유 등 */
  notes: string[];
}

export async function openQuire(bytes: Uint8Array): Promise<OpenedQuire> {
  const entries = await readZip(bytes);
  const get = (name: string) => entries.find((e) => e.name === name)?.data;
  if (entries[0]?.name !== 'mimetype' || entries[0].method !== 0 || decoder.decode(entries[0].data) !== MIMETYPE) throw new Error('.quire: mimetype must be the first entry');
  const m = get('manifest.json');
  if (!m) throw new Error('.quire: manifest.json is missing');
  const manifest = JSON.parse(decoder.decode(m)) as Manifest;
  if (manifest.format !== 'quire' || typeof manifest.formatVersion !== 'number') throw new Error('.quire: bad manifest');
  const notes: string[] = [];
  const j = get('document.json');
  if (!j) throw new Error('.quire: document.json is missing');
  for (const [name, info] of Object.entries(manifest.files ?? {})) {
    const data = get(name);
    if (data && info.sha256 && (await sha256Hex(data)) !== info.sha256) notes.push(`${name}: manifest hash differs (edited outside Quire?)`);
  }
  const { doc, readOnly: newerSchema } = migrateQuire(JSON.parse(decoder.decode(j)));
  const readOnly = newerSchema || manifest.formatVersion > FORMAT_VERSION;
  const text = textFromQuire(doc);
  let crdt: Uint8Array | null = get('history/crdt.bin') ?? null;
  if (crdt) {
    // 정본을 다시 정규화해 비교한다 (손으로 고친 JSON의 공백·키 순서 차이는 무시)
    const want = await stateHash(quireFromDoc(docFromQuire(doc).doc));
    let have: string | null = null;
    try {
      const loro = newLoro(1);
      loro.import(crdt);
      have = await stateHash(quireFromDoc(docFromLoro(loro)));
    } catch (e) {
      notes.push(`history/crdt.bin: cannot be read (${String(e)})`);
    }
    if (have !== want) {
      if (have !== null) notes.push('history/crdt.bin: state differs from document.json; history dropped');
      crdt = null;
    }
  }
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
  return { doc, text, crdt, readOnly, notes, assets };
}
