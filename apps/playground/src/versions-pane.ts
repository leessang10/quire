/**
 * 버전 창 (14 §5, 4-5·4-6): 서버의 버전 목록(새것부터)과 이름 붙이기, 버전 보기(읽기 전용, 최종본 보기와 같은 길),
 * 비교(앞 버전·지금과: 판 이력을 받아 클라이언트에서 diff → 제안 표시), 복원(두 번 눌러 확인).
 * 목록은 열 때·버전을 만들 때·몇 초마다 다시 읽는다 (자동 버전은 서버가 남긴다).
 */
import type { Editor } from '@quire/editor';
import { compareVersions, documentFromSnapshot, type Frontiers } from '@quire/sync';
import { LoroDoc } from 'loro-crdt';

interface Item {
  id: string;
  epoch: string;
  time: number;
  auto: boolean;
  name?: string;
  current: boolean;
  authors: Array<{ name: string; color: string }>;
  frontiers: Frontiers;
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
  private readonly bannerText: HTMLElement;
  private readonly actions: HTMLElement;
  private label = '';
  private armed = false;

  constructor(
    root: HTMLElement,
    private readonly editor: Editor,
    private readonly base: string,
    /** 권한 토큰 (14 §6): '?token=…' 또는 '' */
    private readonly q = '',
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
    this.bannerText = document.createElement('div');
    this.actions = document.createElement('div');
    this.actions.className = 'vs-actions';
    this.bannerEl.append(this.bannerText, this.actions);
    this.listEl = document.createElement('ol');
    this.listEl.className = 'vs-list';
    root.append(head, this.bannerEl, this.listEl);
    void this.refresh();
    setInterval(() => void this.refresh(), 5000);
  }

  async refresh(): Promise<void> {
    try {
      const res = await fetch(`${this.base}/versions${this.q}`);
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
    await fetch(`${this.base}/versions${this.q}`, { method: 'POST', body: JSON.stringify({ name: label }) });
    await this.refresh();
  }

  private async view(id: string | null): Promise<void> {
    this.armed = false;
    if (id === null) {
      this.viewing = null;
      this.editor.previewDocument(null);
      this.render();
      return;
    }
    const res = await fetch(`${this.base}/versions/${id}${this.q}`);
    if (!res.ok) return;
    const doc = documentFromSnapshot(new Uint8Array(await res.arrayBuffer()));
    this.viewing = id;
    const v = this.items.find((x) => x.id === id)!;
    this.label = `${v.name ?? fmt(v.time)} 버전을 보는 중 (읽기 전용)`;
    this.editor.previewDocument(doc);
    this.render();
  }

  /** 같은 판의 바로 앞 버전 */
  private prevOf(v: Item): Item | null {
    const i = this.items.indexOf(v);
    return this.items.slice(i + 1).find((x) => x.epoch === v.epoch) ?? null;
  }

  /** 비교 (14 §5.3): 그 판의 이력을 받아 두 frontiers 사이의 차이를 제안 표시로 (읽기 전용) */
  private async compare(v: Item, against: 'prev' | 'now'): Promise<void> {
    const res = await fetch(`${this.base}/history/${v.epoch || '_'}${this.q}`);
    if (!res.ok) return;
    const loro = new LoroDoc();
    loro.import(new Uint8Array(await res.arrayBuffer()));
    const prev = this.prevOf(v);
    const now = loro.frontiers().map((f) => ({ peer: String(f.peer), counter: f.counter }));
    const [from, to] = against === 'prev' ? [prev!.frontiers, v.frontiers] : [v.frontiers, now];
    const doc = compareVersions(loro, from, to);
    this.viewing = v.id;
    this.label = against === 'prev' ? `비교: ${prev!.name ?? fmt(prev!.time)} → ${v.name ?? fmt(v.time)}` : `비교: ${v.name ?? fmt(v.time)} → 지금`;
    this.editor.previewDocument(doc);
    this.render();
  }

  /** 복원 (14 §5.4): 서버가 새 변경으로 만들어 모든 피어에 보낸다. 복원 직전 상태는 자동 버전으로 남는다 */
  private async restore(v: Item): Promise<void> {
    if (!this.armed) {
      this.armed = true;
      this.render();
      return;
    }
    this.armed = false;
    const res = await fetch(`${this.base}/versions/${v.id}/restore${this.q}`, { method: 'POST' });
    if (res.ok) await this.view(null);
    await this.refresh();
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
    this.actions.replaceChildren();
    if (!v) return;
    this.bannerText.textContent = this.label;
    const btn = (text: string, fn: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.disabled = disabled;
      b.addEventListener('click', fn);
      this.actions.append(b);
    };
    btn('보기', () => void this.view(v.id));
    btn('앞 버전과 비교', () => void this.compare(v, 'prev'), !this.prevOf(v));
    btn('지금과 비교', () => void this.compare(v, 'now'), !v.current);
    btn(this.armed ? '정말 복원할까요? 다시 누르세요' : '이 버전으로 복원', () => void this.restore(v));
  }
}
