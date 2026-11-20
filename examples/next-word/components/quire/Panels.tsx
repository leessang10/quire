'use client';
/** 옆 창(개요·댓글과 제안), 찾기 카드, 상태 줄 */
import { useEffect, useRef, useState } from 'react';
import { CaseSensitive, Check, ChevronDown, ChevronUp, MessageSquare, Regex, Undo2, WholeWord, X } from 'lucide-react';
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
import { outline, type Ui } from '@/lib/quire-app';

// ── 개요 ──────────────────────────────────────────────

export function OutlinePanel({ editor }: { editor: Editor | null; version: number }) {
  const items = editor ? outline(editor) : [];
  return (
    <nav aria-label="개요" className="flex h-full w-56 shrink-0 flex-col border-r bg-background">
      <div className="px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">개요</div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-4">
        {items.length === 0 && <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">제목 1–3 스타일을 쓴 문단이 여기 나타납니다.</p>}
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
const KIND_LABEL: Record<string, string> = { insert: '넣음', delete: '지움', format: '서식', para: '문단', move: '옮김', moveFrom: '옮김', table: '표' };

export function ReviewPanel(props: { editor: Editor | null; version: number; composing: boolean; onComposeDone: () => void }) {
  const { editor, composing, onComposeDone } = props;
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
    <aside aria-label="댓글과 제안" className="flex h-full w-80 shrink-0 flex-col border-l bg-muted/20">
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-b px-3 py-2">
          <TabsList className="w-full">
            <TabsTrigger value="comments">
              댓글 {open.length > 0 && <Badge variant="secondary">{open.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="suggestions">
              제안 {suggestions.length > 0 && <Badge variant="secondary">{suggestions.length}</Badge>}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="comments" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3">
              {composing && <Composer editor={editor} onDone={onComposeDone} />}
              {open.length === 0 && !composing && <Empty icon={<MessageSquare className="size-5" />} text="글을 고르고 Ctrl+Alt+M 또는 삽입 › 댓글로 댓글을 답니다." />}
              {open.map((t) => (
                <ThreadCard key={t.id} t={t} editor={editor} focused={caret === t.id} />
              ))}
              {rest.length > 0 && (
                <Button variant="link" size="sm" className="h-auto px-0 text-muted-foreground" onClick={() => setShowResolved(!showResolved)}>
                  {showResolved ? '해결한 댓글 숨기기' : `해결함 · 글이 지워진 댓글 ${rest.length}`}
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
                    모두 수락
                  </Button>
                  <Button variant="outline" className="flex-1" size="sm" onClick={() => editor?.rejectAll()}>
                    모두 거부
                  </Button>
                </div>
              )}
              {suggestions.length === 0 && <Empty icon={<Check className="size-5" />} text="도구 막대 오른쪽 끝에서 ‘제안’으로 바꾸고 고치면 여기에 제안으로 모입니다." />}
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
        placeholder="댓글 (Ctrl+Enter로 달기)"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          취소
        </Button>
        <Button size="sm" disabled={!text.trim()} onClick={submit}>
          달기
        </Button>
      </div>
    </Card>
  );
}

function ThreadCard({ t, editor, focused }: { t: ThreadView; editor: Editor | null; focused: boolean }) {
  const [reply, setReply] = useState('');
  return (
    <Card focused={focused} className={cn('cursor-pointer', t.resolved && 'opacity-70')} onMouseDown={(e) => !(e.target as HTMLElement).closest('button, input') && editor?.revealThread(t.id)}>
      {t.orphan && <Badge variant="outline" className="mb-1.5">글이 지워진 곳</Badge>}
      <div className="space-y-2.5">
        {t.messages.map((m) => (
          <div key={m.id}>
            <Author color={m.author.color} name={m.author.name} time={m.time} extra={m.edited ? '(고침)' : undefined} />
            <p className={cn('mt-1 whitespace-pre-wrap', m.deleted && 'italic text-muted-foreground')}>{m.deleted ? '지운 메시지' : m.text}</p>
          </div>
        ))}
      </div>
      {!t.resolved && !t.orphan && (
        <Input
          className="mt-2.5 h-7 text-xs"
          value={reply}
          placeholder="답글 (Enter)"
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && reply.trim()) {
              editor?.replyComment(t.id, reply.trim());
              setReply('');
            }
          }}
        />
      )}
      <div className="mt-2 flex justify-end gap-1">
        <Button variant="ghost" size="xs" onClick={() => editor?.resolveThread(t.id, !t.resolved)}>
          {t.resolved ? '다시 열기' : '해결'}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => editor?.deleteThread(t.id)}>
          지우기
        </Button>
      </div>
    </Card>
  );
}

function SuggestionCard({ s, editor }: { s: SuggestionView; editor: Editor | null }) {
  const author = s.data.author as { name?: string; color?: string } | undefined;
  const kind = String(s.data.kind);
  return (
    <Card className="cursor-pointer" onMouseDown={(e) => !(e.target as HTMLElement).closest('button') && editor?.revealSuggestion(s.id)}>
      <div className="flex items-center justify-between">
        <Author color={author?.color ?? '#888'} name={author?.name ?? '?'} time={Number(s.data.time) || 0} />
        <Badge variant={kind === 'delete' ? 'destructive' : 'secondary'}>{KIND_LABEL[kind] ?? kind}</Badge>
      </div>
      <p className="mt-1.5">{s.summary}</p>
      <div className="mt-2 flex justify-end gap-1">
        <Button variant="ghost" size="xs" className="text-emerald-700" onClick={() => editor?.acceptSuggestion(s.id)}>
          <Check /> 수락
        </Button>
        <Button variant="ghost" size="xs" onClick={() => editor?.rejectSuggestion(s.id)}>
          <Undo2 /> 거부
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
  const count = !status || !q ? '' : status.error ? '잘못된 식' : !status.count ? '결과 없음' : `${status.current >= 0 ? status.current + 1 : '–'}/${status.count}${status.truncated ? '+' : ''}`;
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
        <Input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => key(e, () => go(e.shiftKey ? -1 : 1))} placeholder="문서에서 찾기" aria-label="찾을 글" aria-invalid={!!status?.error && !!q} className="h-8" />
        <span className="w-14 shrink-0 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {count}
        </span>
        {opt('caseSensitive', '대소문자 구분', <CaseSensitive />)}
        {opt('wholeWord', '낱말 단위', <WholeWord />)}
        {opt('regex', '정규식', <Regex />)}
        <Separator orientation="vertical" className="mx-0.5 h-5!" />
        <Button variant="ghost" size="icon-sm" aria-label="앞 결과" onClick={() => go(-1)}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="다음 결과" onClick={() => go(1)}>
          <ChevronDown />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="찾기 닫기" onClick={close}>
          <X />
        </Button>
      </div>
      {showReplace ? (
        <div className="mt-1.5 flex items-center gap-1">
          <Input value={r} onChange={(e) => setR(e.target.value)} onKeyDown={(e) => key(e, doReplace)} placeholder="바꿀 글" aria-label="바꿀 글" className="h-8" />
          <Button variant="outline" size="sm" onClick={doReplace}>
            바꾸기
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!editor) return;
              const n = editor.replaceAll(r);
              setStatus(editor.findStatus());
              setNote(`${n}개 바꿈`);
            }}
          >
            모두
          </Button>
        </div>
      ) : (
        <Button variant="link" size="sm" className="h-auto px-1" onClick={() => setShowReplace(true)}>
          바꾸기…
        </Button>
      )}
      {note && <div className="mt-1 px-1 text-xs text-emerald-700">{note}</div>}
    </div>
  );
}

// ── 상태 줄 ───────────────────────────────────────────

export function StatusBar({ ui, count, input }: { ui: Ui | null; count: WordCount | null; input: string }) {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t bg-background px-4 text-xs text-muted-foreground">
      <span>{ui ? `${ui.pages.toLocaleString()}쪽` : '…'}</span>
      {ui && ui.section.count > 1 && <span>구역 {ui.section.index + 1}/{ui.section.count}</span>}
      {count && (
        <span>
          {count.chars.toLocaleString()}자 · {count.words.toLocaleString()}어절
        </span>
      )}
      {ui?.suggesting && <Badge variant="secondary" className="text-emerald-700">제안 모드</Badge>}
      {ui && ui.viewMode !== 'suggestions' && <Badge variant="outline">{ui.viewMode === 'final' ? '최종본 보기' : '원본 보기'}</Badge>}
      {ui?.spell && <Badge variant="outline">맞춤법</Badge>}
      <span className="ml-auto">{input}</span>
    </footer>
  );
}
