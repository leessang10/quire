'use client';
/**
 * `/` 명령 메뉴 (Notion식): 문단 머리나 빈칸 뒤에 `/`를 치면 캐럿 아래에 뜬다. 이어 치는 글로 거르고, ↑↓ Enter로 고르면
 * "/찾을 말"을 지우고(편집기 `replaceRange`) 명령을 실행한다. Esc나 빈칸이면 닫힌다.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Footprints, Heading1, Heading2, Heading3, ImagePlus, List, ListOrdered, Quote, SeparatorHorizontal, Table, Type } from 'lucide-react';
import type { QuireController } from '@quiredoc/react';
import type { Editor } from '@quiredoc/editor';
import { cn } from '@/lib/utils';
import { useT, type T } from '@/lib/i18n';

export interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  icon: ReactNode;
  run: (e: Editor) => void;
}

/** 명령 목록. 이름·설명은 지금 언어로, 찾는 낱말(keywords)은 두 언어 모두라 어느 언어로 쳐도 걸린다 */
export function slashCommands(onImage: () => void, t: T): SlashCommand[] {
  const i = 'size-4';
  const named = (id: string) => ({ label: t(`block.${id}` as Parameters<T>[0]), hint: t(`block.${id}.hint` as Parameters<T>[0]) });
  return [
    { id: 'text', ...named('text'), keywords: 'text body plain 본문 텍스트', icon: <Type className={i} />, run: (e) => e.setParagraphStyle('body') },
    { id: 'h1', ...named('h1'), keywords: 'h1 heading title 제목 큰', icon: <Heading1 className={i} />, run: (e) => e.setParagraphStyle('h1') },
    { id: 'h2', ...named('h2'), keywords: 'h2 heading 제목', icon: <Heading2 className={i} />, run: (e) => e.setParagraphStyle('h2') },
    { id: 'h3', ...named('h3'), keywords: 'h3 heading 제목 작은', icon: <Heading3 className={i} />, run: (e) => e.setParagraphStyle('h3') },
    { id: 'bullet', ...named('bullet'), keywords: 'bullet list 글머리 목록', icon: <List className={i} />, run: (e) => e.toggleList('bullet') },
    { id: 'number', ...named('number'), keywords: 'number numbered list 번호 목록', icon: <ListOrdered className={i} />, run: (e) => e.toggleList('number') },
    { id: 'quote', ...named('quote'), keywords: 'quote 인용', icon: <Quote className={i} />, run: (e) => e.setParagraphStyle('quote') },
    { id: 'table', ...named('table'), keywords: 'table 표', icon: <Table className={i} />, run: (e) => e.insertTable(3, 3) },
    { id: 'image', ...named('image'), keywords: 'image picture photo 그림 이미지 사진', icon: <ImagePlus className={i} />, run: () => onImage() },
    { id: 'footnote', ...named('footnote'), keywords: 'footnote note 각주 주석', icon: <Footprints className={i} />, run: (e) => e.insertFootnote() },
    { id: 'pagebreak', ...named('pagebreak'), keywords: 'page break 쪽 나누기', icon: <SeparatorHorizontal className={i} />, run: (e) => e.insertPageBreak() },
  ];
}

interface Slash {
  /** "/"의 자리 (지금 스토리 오프셋) */
  start: number;
  query: string;
  x: number;
  y: number;
}

/** 캐럿 앞 글이 "/찾을 말"이면 그 자리 */
function slashAt(e: Editor): { start: number; query: string } | null {
  const sel = e.selection();
  if (sel.anchor !== sel.head) return null;
  const doc = e.doc;
  const p = doc.paragraphs()[doc.paragraphIndexAt(sel.head)];
  if (!p) return null;
  const before = Array.from(p.text).slice(0, sel.head - p.start).join('');
  const m = /(?:^|\s)\/([^\s/]{0,24})$/.exec(before);
  if (!m) return null;
  return { start: sel.head - Array.from(m[1]!).length - 1, query: m[1]! };
}

export function SlashMenu({ ctl, version, commands }: { ctl: QuireController; version: number; commands: SlashCommand[] }) {
  const t = useT();
  const [slash, setSlash] = useState<Slash | null>(null);
  const [active, setActive] = useState(0);
  const closedAt = useRef<number | null>(null);
  // 상태가 바뀔 때마다 캐럿 앞을 본다
  useEffect(() => {
    const h = ctl.handle;
    if (!h) return;
    const s = slashAt(h.editor);
    if (!s || closedAt.current === s.start) {
      if (!s) closedAt.current = null;
      setSlash(null);
      return;
    }
    const r = h.caretRect();
    if (!r) return setSlash(null);
    setSlash((cur) => {
      if (!cur || cur.query !== s.query) setActive(0);
      return { ...s, x: r.x, y: r.y + r.height + 4 };
    });
  }, [ctl, version]);
  const items = useMemo(() => {
    const q = slash?.query.toLowerCase() ?? '';
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q)) : commands;
  }, [slash, commands]);
  const choose = (c: SlashCommand | undefined) => {
    const h = ctl.handle;
    if (!h || !slash || !c) return;
    const e = h.editor;
    const end = e.selection().head;
    e.replaceRange(slash.start, end, '');
    setSlash(null);
    c.run(e);
    setTimeout(() => e.focus(), 0);
  };
  // 메뉴가 열려 있으면 ↑↓ Enter Esc를 편집기보다 먼저 받는다
  const ref = useRef({ items, active, slash, choose });
  ref.current = { items, active, slash, choose };
  useEffect(() => {
    if (!slash) return;
    const onKey = (ev: KeyboardEvent) => {
      const { items: list, active: a, choose: pick, slash: sl } = ref.current;
      if (!sl) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        setActive((a + (ev.key === 'ArrowDown' ? 1 : -1) + list.length) % Math.max(1, list.length));
      } else if (ev.key === 'Enter' || ev.key === 'Tab') {
        if (!list.length) return;
        pick(list[a]);
      } else if (ev.key === 'Escape') {
        closedAt.current = sl.start;
        setSlash(null);
      } else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [slash]);
  if (!slash) return null;
  return (
    <div role="listbox" aria-label={t('slash.label')} className="fixed z-50 w-72 overflow-hidden rounded-lg border bg-popover p-1 shadow-xl" style={{ left: slash.x, top: Math.min(slash.y, innerHeight - 340) }}>
      <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">{slash.query ? t('slash.searching', { query: slash.query }) : t('slash.basic')}</div>
      <div className="max-h-72 overflow-y-auto">
        {items.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">{t('slash.none')}</div>}
        {items.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(c)}
            className={cn('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left', i === active && 'bg-accent')}
          >
            <span className="flex size-9 items-center justify-center rounded-md border bg-background">{c.icon}</span>
            <span className="flex flex-col">
              <span className="text-sm">{c.label}</span>
              <span className="text-xs text-muted-foreground">{c.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
