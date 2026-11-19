/**
 * 버전 창 (14 §5, 4-5): 서버의 버전 목록(새것부터)과 이름 붙이기, 버전 보기(읽기 전용, 최종본 보기와 같은 길).
 * 목록은 열 때·버전을 만들 때·몇 초마다 다시 읽는다 (자동 버전은 서버가 남긴다).
 */
import type { Editor } from '@quire/editor';
import { documentFromSnapshot } from '@quire/sync';

interface Item {
  id: string;
  epoch: string;
  time: number;
  auto: boolean;
  name?: string;
  current: boolean;
  authors: Array<{ name: string; color: string }>;
}

const fmt = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

export class VersionsPane {
  private items: Item[] = [];
  private viewing: string | null = null;
  private readonly listEl: HTMLOListElement;
  private readonly bannerEl: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly editor: Editor,
    private readonly base: string,
  ) {
    root.replaceChildren();
    const head = document.createElement('div');
    head.className = 'vs-head';
    const h = document.createElement('h2');
    h.textContent = '버전 기록';
    const name = document.createElement('button');
    name.textContent = '지금 버전에 이름…';
    name.addEventListener('click', () => void this.nameNow());
    head.append(h, name);
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'vs-banner';
    this.bannerEl.hidden = true;
    this.listEl = document.createElement('ol');
    this.listEl.className = 'vs-list';
    root.append(head, this.bannerEl, this.listEl);
    void this.refresh();
    setInterval(() => void this.refresh(), 5000);
  }

  async refresh(): Promise<void> {
    try {
      const res = await fetch(`${this.base}/versions`);
      if (!res.ok) return;
      this.items = (await res.json()) as Item[];
      this.render();
    } catch {
      /* 서버가 꺼져 있음 */
    }
  }

  private async nameNow(): Promise<void> {
    const label = prompt('버전 이름');
    if (!label?.trim()) return;
    await fetch(`${this.base}/versions`, { method: 'POST', body: JSON.stringify({ name: label }) });
    await this.refresh();
  }

  private async view(id: string | null): Promise<void> {
    if (id === null) {
      this.viewing = null;
      this.editor.previewDocument(null);
      this.render();
      return;
    }
    const res = await fetch(`${this.base}/versions/${id}`);
    if (!res.ok) return;
    const doc = documentFromSnapshot(new Uint8Array(await res.arrayBuffer()));
    this.viewing = id;
    this.editor.previewDocument(doc);
    this.render();
  }

  private render(): void {
    this.listEl.replaceChildren();
    const cur = document.createElement('li');
    cur.className = this.viewing === null ? 'is-on' : '';
    const b0 = document.createElement('button');
    b0.textContent = '지금 문서 (편집)';
    b0.addEventListener('click', () => void this.view(null));
    cur.append(b0);
    this.listEl.append(cur);
    for (const v of this.items) {
      const li = document.createElement('li');
      li.className = v.id === this.viewing ? 'is-on' : '';
      const b = document.createElement('button');
      const title = document.createElement('b');
      title.textContent = v.name ?? fmt(v.time);
      const meta = document.createElement('span');
      meta.className = 'vs-meta';
      meta.textContent = `${v.name ? fmt(v.time) : '자동'}${v.current ? '' : ' · 앞 판'}`;
      const who = document.createElement('span');
      who.className = 'vs-who';
      for (const a of v.authors) {
        const dot = document.createElement('i');
        dot.style.background = a.color;
        who.append(dot, document.createTextNode(a.name));
      }
      b.append(title, meta, who);
      b.addEventListener('click', () => void this.view(v.id));
      li.append(b);
      this.listEl.append(li);
    }
    const v = this.items.find((x) => x.id === this.viewing);
    this.bannerEl.hidden = !v;
    if (v) this.bannerEl.textContent = `${v.name ?? fmt(v.time)} 버전을 보는 중 (읽기 전용)`;
  }
}
