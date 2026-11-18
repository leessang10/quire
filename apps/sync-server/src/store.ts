/// <reference types="node" />
/**
 * 방 저장소 (09 §9). 방 하나 = 디렉터리 하나.
 *
 *   snapshot.bin          마지막 체크포인트의 Loro 스냅샷
 *   log.bin               그 뒤의 업데이트 ([길이 u32 BE][업데이트]…, 받는 즉시 덧붙임)
 *   document.json         방이 빌 때·압축할 때의 정본 JSON (07 §4) — 사람이 읽고 외부 도구가 쓰는 사본
 *   epochs/<판>/base.bin  그 판의 처음 상태 (압축으로 만든 판만)
 *   epochs/<판>/final.bin 그 판의 마지막 상태 (다음 판으로 압축할 때)
 *   epochs/<판>/next      다음 판 ID
 *   assets/<ID>           자산(이미지 원본, 11 §2.2). 파일 이름 = 내용 해시, assets/<ID>.type = MIME
 *
 * 첫 판의 ID는 ''이고 디렉터리 이름은 '_'이다. 쓰기는 임시 파일에 쓴 뒤 이름을 바꾼다 (중간에 죽어도 반쪽 파일이 남지 않음).
 * 로그 끝의 잘린 레코드(덧붙이다 죽음)는 버린다.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RoomData {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}

export interface RoomStore {
  load(): RoomData;
  append(update: Uint8Array): void;
  /** 스냅샷을 쓰고 로그를 비운다. documentJson이 있으면 정본 JSON도 쓴다 */
  checkpoint(snapshot: Uint8Array, documentJson: string | null): void;
  /** 판을 바꾼다: 옛 판의 마지막 상태와 새 판의 처음 상태를 남기고, 새 판 처음 상태로 체크포인트 */
  saveEpoch(old: string, final: Uint8Array, next: string, base: Uint8Array, documentJson: string): void;
  epochFinal(id: string): { final: Uint8Array; next: string } | null;
  epochBase(id: string): Uint8Array | null;
  documentJson(): string | null;
  /** 자산 (내용 주소: 같은 ID는 같은 바이트) */
  putAsset(id: string, mime: string, bytes: Uint8Array): void;
  getAsset(id: string): { mime: string; bytes: Uint8Array } | null;
}

export interface Storage {
  room(name: string): RoomStore;
}

const dirName = (epoch: string) => (epoch === '' ? '_' : epoch);

/** 디스크 저장소 */
export function fileStorage(root: string): Storage {
  return {
    room(name) {
      const dir = join(root, encodeURIComponent(name));
      return new FileRoom(dir);
    },
  };
}

class FileRoom implements RoomStore {
  constructor(private readonly dir: string) {}

  private path(...p: string[]): string {
    return join(this.dir, ...p);
  }

  private read(...p: string[]): Uint8Array | null {
    const f = this.path(...p);
    return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
  }

  private write(data: Uint8Array | string, ...p: string[]): void {
    const f = this.path(...p);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(`${f}.tmp`, data);
    renameSync(`${f}.tmp`, f);
  }

  load(): RoomData {
    const snapshot = this.read('snapshot.bin');
    const log = this.read('log.bin');
    const updates: Uint8Array[] = [];
    if (log) {
      const v = new DataView(log.buffer, log.byteOffset, log.byteLength);
      let at = 0;
      while (at + 4 <= log.length) {
        const n = v.getUint32(at);
        if (at + 4 + n > log.length) break; // 잘린 마지막 레코드
        updates.push(log.slice(at + 4, at + 4 + n));
        at += 4 + n;
      }
    }
    return { snapshot, updates };
  }

  append(update: Uint8Array): void {
    mkdirSync(this.dir, { recursive: true });
    const rec = new Uint8Array(4 + update.length);
    new DataView(rec.buffer).setUint32(0, update.length);
    rec.set(update, 4);
    appendFileSync(this.path('log.bin'), rec);
  }

  checkpoint(snapshot: Uint8Array, documentJson: string | null): void {
    this.write(snapshot, 'snapshot.bin');
    if (documentJson !== null) this.write(documentJson, 'document.json');
    // 스냅샷이 로그 내용을 모두 담으므로 로그를 비운다 (스냅샷을 먼저 바꿔 두어 여기서 죽어도 잃지 않음)
    this.write(new Uint8Array(0), 'log.bin');
  }

  saveEpoch(old: string, final: Uint8Array, next: string, base: Uint8Array, documentJson: string): void {
    this.write(final, 'epochs', dirName(old), 'final.bin');
    this.write(base, 'epochs', dirName(next), 'base.bin');
    this.write(next, 'epochs', dirName(old), 'next');
    this.checkpoint(base, documentJson);
  }

  epochFinal(id: string): { final: Uint8Array; next: string } | null {
    const final = this.read('epochs', dirName(id), 'final.bin');
    const next = this.read('epochs', dirName(id), 'next');
    return final && next ? { final, next: new TextDecoder().decode(next) } : null;
  }

  epochBase(id: string): Uint8Array | null {
    return this.read('epochs', dirName(id), 'base.bin');
  }

  documentJson(): string | null {
    const b = this.read('document.json');
    return b ? new TextDecoder().decode(b) : null;
  }

  putAsset(id: string, mime: string, bytes: Uint8Array): void {
    if (existsSync(this.path('assets', id))) return;
    this.write(mime, 'assets', `${id}.type`);
    this.write(bytes, 'assets', id);
  }

  getAsset(id: string): { mime: string; bytes: Uint8Array } | null {
    const bytes = this.read('assets', id);
    if (!bytes) return null;
    const t = this.read('assets', `${id}.type`);
    return { mime: t ? new TextDecoder().decode(t) : 'application/octet-stream', bytes };
  }
}

/** 메모리 저장소 (서버 프로세스가 사는 동안만) */
export function memoryStorage(): Storage {
  const rooms = new Map<string, MemoryRoom>();
  return {
    room(name) {
      let r = rooms.get(name);
      if (!r) rooms.set(name, (r = new MemoryRoom()));
      return r;
    },
  };
}

class MemoryRoom implements RoomStore {
  private snapshot: Uint8Array | null = null;
  private updates: Uint8Array[] = [];
  private json: string | null = null;
  private readonly finals = new Map<string, { final: Uint8Array; next: string }>();
  private readonly bases = new Map<string, Uint8Array>();

  load(): RoomData {
    return { snapshot: this.snapshot, updates: [...this.updates] };
  }
  append(update: Uint8Array): void {
    this.updates.push(update);
  }
  checkpoint(snapshot: Uint8Array, documentJson: string | null): void {
    this.snapshot = snapshot;
    if (documentJson !== null) this.json = documentJson;
    this.updates = [];
  }
  saveEpoch(old: string, final: Uint8Array, next: string, base: Uint8Array, documentJson: string): void {
    this.finals.set(old, { final, next });
    this.bases.set(next, base);
    this.checkpoint(base, documentJson);
  }
  epochFinal(id: string) {
    return this.finals.get(id) ?? null;
  }
  epochBase(id: string) {
    return this.bases.get(id) ?? null;
  }
  documentJson() {
    return this.json;
  }
  private readonly assets = new Map<string, { mime: string; bytes: Uint8Array }>();
  putAsset(id: string, mime: string, bytes: Uint8Array): void {
    if (!this.assets.has(id)) this.assets.set(id, { mime, bytes });
  }
  getAsset(id: string) {
    return this.assets.get(id) ?? null;
  }
}
