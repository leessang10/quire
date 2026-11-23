'use client';
/** 옆 창(개요·댓글과 제안), 찾기 카드, 상태 줄 */
import { useEffect, useRef, useState } from 'react';
import { CaseSensitive, Check, ChevronDown, ChevronUp, MessageSquare, Minus, MoveHorizontal, Plus, Regex, Undo2, WholeWord, X } from 'lucide-react';
import type { Editor, FindStatus, SuggestionView, ThreadView, WordCount } from '@quire/editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { outline, zoomPercent, zoomStep, type Ui } from '@/lib/quire-app';
import type { Act } from '@/lib/use-ui';
import { useT } from '@/lib/i18n';
import type { AppMessageKey } from '@/lib/messages';

// ── 개요 ──────────────────────────────────────────────

export function OutlinePanel({ editor }: { editor: Editor | null; version: number }) {
  const items = editor ? outline(editor) : [];
  const t = useT();
  return (
    <nav aria-label={t('view.outline')} className="flex h-full w-56 shrink-0 flex-col border-r bg-background">
      <div className="px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">{t('view.outline')}</div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-4">
        {items.length === 0 && <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">{t('outline.empty')}</p>}
        {items.map((h, i) => (
          <button
            key={i}
            type="button"
            title={h.text}
            onClick={() => {
              editor?.select(h.offset);
              editor?.focus();
            }}
            className={cn('block w-full truncate rounded-md py-1 pr-2 text-left text-sm hover:bg-muted', h.level === 1 && 'font-medium')}
            style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
          >
            {h.text}
          </button>
        ))}
      </ScrollArea>
    </nav>
  );
}

// ── 댓글·제안 ─────────────────────────────────────────

const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** 제안 종류 → 메시지 키 */
const KIND_KEY: Record<string, AppMessageKey> = { insert: 'kind.insert', delete: 'kind.delete', format: 'kind.format', para: 'kind.para', move: 'kind.move', moveFrom: 'kind.move', table: 'kind.table' };

export function ReviewPanel(props: { editor: Editor | null; version: number; composing: boolean; onComposeDone: () => void }) {
  const { editor, composing, onComposeDone } = props;
  const t = useT();
  const [tab, setTab] = useState<string>('comments');
  const [showResolved, setShowResolved] = useState(false);
  const threads: ThreadView[] = editor?.threads() ?? [];
  const suggestions: SuggestionView[] = editor?.suggestionViews() ?? [];
  const open = threads.filter((t) => !t.resolved && !t.orphan);
  const rest = threads.filter((t) => t.resolved || t.orphan);
  const caret = editor?.threadsAtCaret()[0] ?? null;
  useEffect(() => {
    if (composing) setTab('comments');
  }, [composing]);
  return (
    <aside aria-label={t('review.label')} className="flex h-full w-80 shrink-0 flex-col border-l bg-muted/20">
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-b px-3 py-2">
          <TabsList className="w-full">
            <TabsTrigger value="comments">
              {t('review.comments')} {open.length > 0 && <Badge variant="secondary">{open.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="suggestions">
              {t('review.suggestions')} {suggestions.length > 0 && <Badge variant="secondary">{suggestions.length}</Badge>}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="comments" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              {composing && <Composer editor={editor} onDone={onComposeDone} />}
              {open.length === 0 && !composing && <Empty icon={<MessageSquare className="size-5" />} text={t('review.commentsEmpty')} />}
              {open.map((t) => (
                <ThreadCard key={t.id} t={t} editor={editor} focused={caret === t.id} />
              ))}
              {rest.length > 0 && (
                <Button variant="link" size="sm" className="h-auto px-0 text-muted-foreground" onClick={() => setShowResolved(!showResolved)}>
                  {showResolved ? t('review.hideResolved') : t('review.showResolved', { count: rest.length })}
                </Button>
              )}
              {showResolved && rest.map((t) => <ThreadCard key={t.id} t={t} editor={editor} focused={false} />)}
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="suggestions" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              {suggestions.length > 0 && (
                <div className="flex gap-2">
                  <Button className="flex-1" size="sm" onClick={() => editor?.acceptAll()}>
                    {t('review.acceptAll')}
                  </Button>
                  <Button variant="outline" className="flex-1" size="sm" onClick={() => editor?.rejectAll()}>
                    {t('review.rejectAll')}
                  </Button>
                </div>
              )}
              {suggestions.length === 0 && <Empty icon={<Check className="size-5" />} text={t('review.suggestionsEmpty')} />}
              {suggestions.map((s) => (
                <SuggestionCard key={s.id} s={s} editor={editor} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs leading-5 text-muted-foreground">
      {icon}
      {text}
    </div>
  );
}

function Card({ children, focused, onMouseDown, className }: { children: React.ReactNode; focused?: boolean; onMouseDown?: (e: React.MouseEvent) => void; className?: string }) {
  return (
    <article onMouseDown={onMouseDown} className={cn('rounded-xl border bg-card p-3 text-sm shadow-xs transition-colors', focused ? 'border-primary/50 ring-3 ring-primary/10' : 'hover:border-foreground/20', className)}>
      {children}
    </article>
  );
}

function Author({ color, name, time, extra }: { color: string; name: string; time: number; extra?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="size-2 rounded-full" style={{ background: color }} />
      <b className="font-medium">{name}</b>
      <time className="text-muted-foreground">{fmtTime(time)}</time>
      {extra && <span className="text-muted-foreground">{extra}</span>}
    </div>
  );
}

function Composer({ editor, onDone }: { editor: Editor | null; onDone: () => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const t = useT();
  useEffect(() => ref.current?.focus(), []);
  const submit = () => {
    if (text.trim()) editor?.addComment(text.trim());
    onDone();
    editor?.focus();
  };
  return (
    <Card focused>
      <Textarea
        ref={ref}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
          if (e.key === 'Escape') onDone();
        }}
        placeholder={t('review.composer')}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          {t('dialog.cancel')}
        </Button>
        <Button size="sm" disabled={!text.trim()} onClick={submit}>
          {t('review.post')}
        </Button>
      </div>
    </Card>
  );
}

function ThreadCard({ t: th, editor, focused }: { t: ThreadView; editor: Editor | null; focused: boolean }) {
  const [reply, setReply] = useState('');
  const t = useT();
  return (
    <Card focused={focused} className={cn('cursor-pointer', th.resolved && 'opacity-70')} onMouseDown={(e) => !(e.target as HTMLElement).closest('button, input') && editor?.revealThread(th.id)}>
      {th.orphan && <Badge variant="outline" className="mb-1.5">{t('review.orphan')}</Badge>}
      <div className="space-y-2.5">
        {th.messages.map((m) => (
          <div key={m.id}>
            <Author color={m.author.color} name={m.author.name} time={m.time} extra={m.edited ? t('review.edited') : undefined} />
            <p className={cn('mt-1 whitespace-pre-wrap', m.deleted && 'italic text-muted-foreground')}>{m.deleted ? t('review.deleted') : m.text}</p>
          </div>
        ))}
      </div>
      {!th.resolved && !th.orphan && (
        <Input
          className="mt-2.5 h-7 text-xs"
          value={reply}
          placeholder={t('review.reply')}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && reply.trim()) {
              editor?.replyComment(th.id, reply.trim());
              setReply('');
            }
          }}
        />
      )}
      <div className="mt-2 flex justify-end gap-1">
        <Button variant="ghost" size="xs" onClick={() => editor?.resolveThread(th.id, !th.resolved)}>
          {th.resolved ? t('review.reopen') : t('review.resolve')}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => editor?.deleteThread(th.id)}>
          {t('review.delete')}
        </Button>
      </div>
    </Card>
  );
}

function SuggestionCard({ s, editor }: { s: SuggestionView; editor: Editor | null }) {
  const author = s.data.author as { name?: string; color?: string } | undefined;
  const kind = String(s.data.kind);
  const t = useT();
  return (
    <Card className="cursor-pointer" onMouseDown={(e) => !(e.target as HTMLElement).closest('button') && editor?.revealSuggestion(s.id)}>
      <div className="flex items-center justify-between">
        <Author color={author?.color ?? '#888'} name={author?.name ?? '?'} time={Number(s.data.time) || 0} />
        <Badge variant={kind === 'delete' ? 'destructive' : 'secondary'}>{KIND_KEY[kind] ? t(KIND_KEY[kind]) : kind}</Badge>
      </div>
      <p className="mt-1.5">{s.summary}</p>
      <div className="mt-2 flex justify-end gap-1">
        <Button variant="ghost" size="xs" className="text-emerald-700" onClick={() => editor?.acceptSuggestion(s.id)}>
          <Check /> {t('review.accept')}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => editor?.rejectSuggestion(s.id)}>
          <Undo2 /> {t('review.reject')}
        </Button>
      </div>
    </Card>
  );
}

// ── 찾기·바꾸기 ───────────────────────────────────────

export function FindCard({ editor, replace, onClose }: { editor: Editor | null; replace: boolean; onClose: () => void }) {
  const [q, setQ] = useState(() => {
    const s = editor?.selectedText() ?? '';
    return s && !s.includes('\n') && s.length < 200 ? s : '';
  });
  const [r, setR] = useState('');
  const [opts, setOpts] = useState({ caseSensitive: false, wholeWord: false, regex: false });
  const [status, setStatus] = useState<FindStatus | null>(null);
  const [note, setNote] = useState('');
  const [showReplace, setShowReplace] = useState(replace);
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    if (!editor) return;
    setNote('');
    if (!q) {
      editor.clearFind();
      setStatus(null);
    } else setStatus(editor.find({ text: q, ...opts }));
  }, [q, opts, editor]);
  const close = () => {
    editor?.clearFind();
    onClose();
    editor?.focus();
  };
  const go = (d: 1 | -1) => setStatus(editor?.findNext(d) ?? null);
  const doReplace = () => {
    if (!editor) return;
    editor.replace(r);
    setStatus(editor.findStatus());
  };
  const count = !status || !q ? '' : status.error ? t('find.badRegex') : !status.count ? t('find.none') : `${status.current >= 0 ? status.current + 1 : '–'}/${status.count}${status.truncated ? '+' : ''}`;
  const key = (e: React.KeyboardEvent, enter: () => void) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      enter();
    } else if (e.key === 'Escape') close();
  };
  const opt = (k: keyof typeof opts, label: string, icon: React.ReactNode) => (
    <Toggle size="sm" aria-label={label} title={label} pressed={opts[k]} onPressedChange={(v) => setOpts({ ...opts, [k]: v })}>
      {icon}
    </Toggle>
  );
  return (
    <div role="search" className="absolute right-6 top-3 z-30 w-[400px] rounded-xl border bg-popover p-2 shadow-lg">
      <div className="flex items-center gap-1">
        <Input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => key(e, () => go(e.shiftKey ? -1 : 1))} placeholder={t('find.placeholder')} aria-label={t('find.label')} aria-invalid={!!status?.error && !!q} className="h-8" />
        <span className="w-14 shrink-0 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {count}
        </span>
        {opt('caseSensitive', t('find.case'), <CaseSensitive />)}
        {opt('wholeWord', t('find.word'), <WholeWord />)}
        {opt('regex', t('find.regex'), <Regex />)}
        <Separator orientation="vertical" className="mx-0.5 h-5!" />
        <Button variant="ghost" size="icon-sm" aria-label={t('find.prev')} onClick={() => go(-1)}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t('find.next')} onClick={() => go(1)}>
          <ChevronDown />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t('find.close')} onClick={close}>
          <X />
        </Button>
      </div>
      {showReplace ? (
        <div className="mt-1.5 flex items-center gap-1">
          <Input value={r} onChange={(e) => setR(e.target.value)} onKeyDown={(e) => key(e, doReplace)} placeholder={t('find.with')} aria-label={t('find.with')} className="h-8" />
          <Button variant="outline" size="sm" onClick={doReplace}>
            {t('find.replace')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!editor) return;
              const n = editor.replaceAll(r);
              setStatus(editor.findStatus());
              setNote(t('find.replaced', { count: n }));
            }}
          >
            {t('find.replaceAll')}
          </Button>
        </div>
      ) : (
        <Button variant="link" size="sm" className="h-auto px-1" onClick={() => setShowReplace(true)}>
          {t('find.showReplace')}
        </Button>
      )}
      {note && <div className="mt-1 px-1 text-xs text-emerald-700">{note}</div>}
    </div>
  );
}

// ── 상태 줄 ───────────────────────────────────────────

export function StatusBar({ ui, count, input }: { ui: Ui | null; count: WordCount | null; input: string }) {
  const t = useT();
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t bg-background px-4 text-xs text-muted-foreground">
      <span>{ui ? t('status.pages', { count: ui.pages }) : '…'}</span>
      {ui && ui.section.count > 1 && <span>{t('status.section', { index: ui.section.index + 1, count: ui.section.count })}</span>}
      {count && (
        <span>{t('status.counts', { chars: count.chars, words: count.words })}</span>
      )}
      {ui?.suggesting && <Badge variant="secondary" className="text-emerald-700">{t('status.suggesting')}</Badge>}
      {ui && ui.viewMode !== 'suggestions' && <Badge variant="outline">{ui.viewMode === 'final' ? t('status.final') : t('status.original')}</Badge>}
      {ui?.spell && <Badge variant="outline">{t('status.spell')}</Badge>}
      <span className="ml-auto">{input}</span>
    </footer>
  );
}

/** 슬라이더 0–100 ↔ 배율: 가운데(50)가 100%, 왼쪽 반은 25–100%, 오른쪽 반은 100–400% (Word의 확대 슬라이더처럼) */
const sliderOf = (z: number) => (z <= 1 ? ((z - 0.25) / 0.75) * 50 : 50 + ((z - 1) / 3) * 50);
const zoomOf = (v: number) => (v <= 50 ? 0.25 + (v / 50) * 0.75 : 1 + ((v - 50) / 50) * 3);

/** 상태 줄의 확대·축소: − 슬라이더 + 배율(누르면 100%) 쪽 폭 맞춤 */
export function ZoomBar({ ui, editor, act }: { ui: Ui | null; editor: Editor | null; act: Act }) {
  const t = useT();
  const z = ui?.zoom ?? 1;
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const btn = 'rounded p-1 hover:bg-muted hover:text-foreground';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('zoom.label')}>
      <button type="button" aria-label={t('zoom.out')} title={t('zoom.out')} onMouseDown={keep} onClick={() => act((e) => e.setZoom(zoomStep(e.zoom, -1)))} className={btn}>
        <Minus className="size-3.5" />
      </button>
      <input
        type="range"
        aria-label={t('zoom.label')}
        aria-valuetext={zoomPercent(z)}
        min={0}
        max={100}
        step={1}
        value={Math.round(sliderOf(z))}
        onChange={(ev) => {
          const v = Number(ev.target.value);
          // 가운데 근처는 100%에 붙인다
          editor?.setZoom(Math.abs(v - 50) <= 2 ? 1 : zoomOf(v));
        }}
        className="h-1 w-24 cursor-pointer accent-primary"
      />
      <button type="button" aria-label={t('zoom.in')} title={t('zoom.in')} onMouseDown={keep} onClick={() => act((e) => e.setZoom(zoomStep(e.zoom, 1)))} className={btn}>
        <Plus className="size-3.5" />
      </button>
      <button type="button" title={t('zoom.reset')} onMouseDown={keep} onClick={() => act((e) => e.setZoom(1))} className="w-10 rounded text-right tabular-nums hover:text-foreground">
        {zoomPercent(z)}
      </button>
      <button type="button" aria-label={t('zoom.fitWidth')} title={t('zoom.fitWidth')} onMouseDown={keep} onClick={() => act((e) => e.setZoom(e.fitWidthZoom()))} className={btn}>
        <MoveHorizontal className="size-3.5" />
      </button>
    </div>
  );
}
