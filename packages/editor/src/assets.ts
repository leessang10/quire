/**
 * 자산 저장소 (11 §2.2): 이미지 원본 바이트. ID = 내용 SHA-256의 앞 32자 (16진). CRDT 밖에 둔다.
 *
 * - MemoryAssets: 이 페이지가 사는 동안만 (시험·혼자 쓰기).
 * - HttpAssets: 동기화 서버의 `<방>/assets/<ID>`. 넣으면 먼저 로컬 캐시(IndexedDB, 안 되면 메모리)에 두고 올리기는 뒤에서 한다.
 *   실패한 올리기는 다음 넣기·꺼내기 때와 온라인이 될 때 다시 한다. 꺼내기는 캐시 → 서버.
 */

export interface AssetStore {
  get(id: string): Promise<Blob | null>;
  /** 넣고 ID를 돌려준다 (같은 내용이면 같은 ID) */
  put(blob: Blob): Promise<string>;
}

export async function assetId(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class MemoryAssets implements AssetStore {
  private readonly map = new Map<string, Blob>();
  async get(id: string): Promise<Blob | null> {
    return this.map.get(id) ?? null;
  }
  async put(blob: Blob): Promise<string> {
    const id = await assetId(blob);
    if (!this.map.has(id)) this.map.set(id, blob);
    return id;
  }
}

/** IndexedDB 캐시 (열 수 없으면 메모리만) */
class IdbCache {
  private db: Promise<IDBDatabase | null>;
  private readonly mem = new Map<string, Blob>();

  constructor(name = 'quire-assets') {
    this.db = new Promise((resolve) => {
      try {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('assets');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async get(id: string): Promise<Blob | null> {
    const m = this.mem.get(id);
    if (m) return m;
    const db = await this.db;
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction('assets').objectStore('assets').get(id);
        req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async put(id: string, blob: Blob): Promise<void> {
    this.mem.set(id, blob);
    const db = await this.db;
    if (!db) return;
    try {
      db.transaction('assets', 'readwrite').objectStore('assets').put(blob, id);
    } catch {
      // 캐시는 없어도 된다 (메모리에 있다)
    }
  }
}

export class HttpAssets implements AssetStore {
  private readonly cache: IdbCache;
  /** 아직 올리지 못한 자산 */
  private readonly unsent = new Map<string, Blob>();
  private sending = false;

  /**
   * base: 자산 주소의 앞부분 (예: `http://localhost:8787/방이름/assets/`).
   * token: 권한이 걸린 방의 토큰 (14 §6). 내려받기·올리기에 `?token=`으로 싣는다
   */
  constructor(
    private readonly base: string,
    cacheName?: string,
    private readonly token?: string | null,
  ) {
    this.cache = new IdbCache(cacheName);
    if (typeof window !== 'undefined') window.addEventListener('online', () => void this.flush());
  }

  private url(id: string): string {
    return this.base + id + (this.token ? `?token=${encodeURIComponent(this.token)}` : '');
  }

  async get(id: string): Promise<Blob | null> {
    void this.flush();
    const c = await this.cache.get(id);
    if (c) return c;
    try {
      const r = await fetch(this.url(id));
      if (!r.ok) return null;
      const blob = await r.blob();
      await this.cache.put(id, blob);
      return blob;
    } catch {
      return null;
    }
  }

  async put(blob: Blob): Promise<string> {
    const id = await assetId(blob);
    await this.cache.put(id, blob);
    this.unsent.set(id, blob);
    void this.flush();
    return id;
  }

  /** 올리지 못한 자산을 올린다 (한 번에 하나씩) */
  private async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      for (const [id, blob] of [...this.unsent]) {
        try {
          const r = await fetch(this.url(id), { method: 'PUT', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' } });
          if (r.ok || r.status === 400 || r.status === 413 || r.status === 415) this.unsent.delete(id); // 다시 해도 안 될 오류도 버린다
        } catch {
          break; // 오프라인: 다음에
        }
      }
    } finally {
      this.sending = false;
    }
  }
}
