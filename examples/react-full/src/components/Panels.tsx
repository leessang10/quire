/** 옆 창: 개요(왼쪽), 댓글·제안(오른쪽), 찾기 막대, 상태 줄 */
import { useEffect, useRef, useState } from 'react';
import { CaseSensitive, Check, ChevronDown, ChevronUp, MessageSquare, Regex, Undo, WholeWord, X } from 'lucide-react';
import type { Editor, FindStatus, SuggestionView, ThreadView } from '@quiredoc/editor';
import type { WordCount } from '@quiredoc/editor';
import { outline, type Ui } from '../lib/quire-app';
import { Button } from './ui';

// ── 개요 ──────────────────────────────────────────────

export function OutlinePanel({ editor, version }: { editor: Editor | null; version: number }) {
  const items = editor ? outline(editor) : [];
  void version;
  return (
    <nav aria-label="개요" className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white px-3 py-4">
      <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">개요</h2>
      {items.length === 0 && <p className="px-2 text-xs leading-5 text-slate-400">제목 1–3 스타일을 쓴 문단이 여기 나타납니다.</p>}
      {items.map((h, i) => (
        <button
          key={i}
          type="button"
          onClick={() => {
            editor?.select(h.offset);
            editor?.focus();
          }}
          className="truncate rounded-md px-2 py-1 text-left text-[13px] text-slate-700 hover:bg-slate-100"
          style={{ paddingLeft: 8 + (h.level - 1) * 12, fontWeight: h.level === 1 ? 600 : 400 }}
          title={h.text}
        >
          {h.text}
        </button>
      ))}
    </nav>
  );
}

// ── 댓글·제안 ─────────────────────────────────────────

const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function ReviewPanel(props: { editor: Editor | null; version: number; composing: boolean; onComposeDone: () => void }) {
  const { editor, composing, onComposeDone } = props;
  const [tab, setTab] = useState<'comments' | 'suggestions'>('comments');
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
    <aside aria-label="댓글과 제안" className="flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="flex border-b border-slate-200 bg-white px-2">
        {(
          [
            ['comments', `댓글 ${open.length || ''}`],
            ['suggestions', `제안 ${suggestions.length || ''}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={'border-b-2 px-3 py-2.5 text-[13px] font-medium ' + (tab === k ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800')}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {tab === 'comments' && (
          <>
            {composing && <Composer editor={editor} onDone={onComposeDone} />}
            {open.length === 0 && !composing && <Empty icon={<MessageSquare className="size-5" />} text="글을 고르고 Ctrl+Alt+M 또는 삽입 › 댓글로 댓글을 답니다." />}
            {open.map((t) => (
              <ThreadCard key={t.id} t={t} editor={editor} focused={caret === t.id} />
            ))}
            {rest.length > 0 && (
              <button type="button" onClick={() => setShowResolved(!showResolved)} className="w-full text-left text-xs text-slate-500 hover:text-slate-800">
                {showResolved ? '▾' : '▸'} 해결함 · 글이 지워진 댓글 {rest.length}
              </button>
            )}
            {showResolved && rest.map((t) => <ThreadCard key={t.id} t={t} editor={editor} focused={false} />)}
          </>
        )}
        {tab === 'suggestions' && (
          <>
            {suggestions.length > 0 && (
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={() => editor?.acceptAll()}>
                  모두 수락
                </Button>
                <Button className="flex-1" onClick={() => editor?.rejectAll()}>
                  모두 거부
                </Button>
              </div>
            )}
            {suggestions.length === 0 && <Empty icon={<Check className="size-5" />} text="도구 막대 오른쪽 끝에서 ‘제안’ 모드로 바꾸고 고치면, 고친 것이 여기에 제안으로 모입니다." />}
            {suggestions.map((s) => (
              <SuggestionCard key={s.id} s={s} editor={editor} />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs leading-5 text-slate-400">
      {icon}
      {text}
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
    <div className="rounded-lg border border-sky-300 bg-white p-3 shadow-sm">
      <textarea
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
        className="w-full resize-none rounded-md border border-slate-200 p-2 text-[13px] outline-none focus:border-sky-500"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button variant="primary" disabled={!text.trim()} onClick={submit}>
          달기
        </Button>
      </div>
    </div>
  );
}

function ThreadCard({ t, editor, focused }: { t: ThreadView; editor: Editor | null; focused: boolean }) {
  const [reply, setReply] = useState('');
  return (
    <article
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button, textarea')) return;
        editor?.revealThread(t.id);
      }}
      className={'cursor-pointer rounded-lg border bg-white p-3 shadow-sm transition ' + (focused ? 'border-sky-400 ring-2 ring-sky-100' : 'border-slate-200 hover:border-slate-300') + (t.resolved ? ' opacity-70' : '')}
    >
      {t.orphan && <div className="mb-1 text-[11px] text-amber-700">글이 지워진 곳에 단 댓글</div>}
      {t.messages.map((m) => (
        <div key={m.id} className="mb-2 last:mb-0">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="size-2 rounded-full" style={{ background: m.author.color }} />
            <b className="text-slate-800">{m.author.name}</b>
            <time className="text-slate-400">{fmtTime(m.time)}</time>
            {m.edited && <span className="text-slate-400">(고침)</span>}
          </div>
          <p className={'mt-1 whitespace-pre-wrap text-[13px] ' + (m.deleted ? 'italic text-slate-400' : 'text-slate-700')}>{m.deleted ? '지운 메시지' : m.text}</p>
        </div>
      ))}
      {!t.resolved && !t.orphan && (
        <div className="mt-2 flex gap-1.5">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && reply.trim()) {
                editor?.replyComment(t.id, reply.trim());
                setReply('');
              }
            }}
            placeholder="답글"
            className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-sky-500"
          />
        </div>
      )}
      <div className="mt-2 flex justify-end gap-1">
        <button type="button" onClick={() => editor?.resolveThread(t.id, !t.resolved)} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
          {t.resolved ? '다시 열기' : '해결'}
        </button>
        <button type="button" onClick={() => editor?.deleteThread(t.id)} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
          지우기
        </button>
      </div>
    </article>
  );
}

const KIND_LABEL: Record<string, string> = { insert: '넣음', delete: '지움', format: '서식', para: '문단', move: '옮김', moveFrom: '옮김', table: '표' };

function SuggestionCard({ s, editor }: { s: SuggestionView; editor: Editor | null }) {
  const author = s.data.author as { name?: string; color?: string } | undefined;
  const kind = String(s.data.kind);
  return (
    <article onMouseDown={(e) => !(e.target as HTMLElement).closest('button') && editor?.revealSuggestion(s.id)} className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-slate-300">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="size-2 rounded-full" style={{ background: author?.color ?? '#888' }} />
        <b className="text-slate-800">{author?.name ?? '?'}</b>
        <time className="text-slate-400">{fmtTime(Number(s.data.time) || 0)}</time>
        <span className={'ml-auto rounded-full px-1.5 py-0.5 text-[10px] ' + (kind === 'delete' ? 'bg-rose-50 text-rose-700' : kind === 'insert' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
          {KIND_LABEL[kind] ?? kind}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] text-slate-700">{s.summary}</p>
      <div className="mt-2 flex justify-end gap-1">
        <button type="button" onClick={() => editor?.acceptSuggestion(s.id)} className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
          <Check className="size-3.5" /> 수락
        </button>
        <button type="button" onClick={() => editor?.rejectSuggestion(s.id)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
          <Undo className="size-3.5" /> 거부
        </button>
      </div>
    </article>
  );
}

// ── 찾기·바꾸기 ───────────────────────────────────────

export function FindPanel({ editor, replace, onClose }: { editor: Editor | null; replace: boolean; onClose: () => void }) {
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
  useEffect(() => setShowReplace((v) => v || replace), [replace]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [replace]);
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
  const count = !status || !q ? '' : status.error ? '잘못된 식' : !status.count ? '결과 없음' : `${status.current >= 0 ? status.current + 1 : '–'} / ${status.count}${status.truncated ? '+' : ''}`;
  const Opt = ({ k, label, icon }: { k: keyof typeof opts; label: string; icon: React.ReactNode }) => (
    <button type="button" title={label} aria-label={label} aria-pressed={opts[k]} onClick={() => setOpts({ ...opts, [k]: !opts[k] })} className={'rounded p-1 ' + (opts[k] ? 'bg-sky-100 text-sky-800' : 'text-slate-500 hover:bg-slate-100')}>
      {icon}
    </button>
  );
  const key = (e: React.KeyboardEvent, enter: () => void) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      enter();
    } else if (e.key === 'Escape') close();
  };
  return (
    <div role="search" className="absolute right-6 top-3 z-30 w-[380px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
      <div className="flex items-center gap-1">
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => key(e, () => go(e.shiftKey ? -1 : 1))}
          placeholder="문서에서 찾기"
          aria-label="찾을 글"
          className={'h-8 min-w-0 flex-1 rounded-md border px-2 text-[13px] outline-none focus:border-sky-500 ' + (status?.error && q ? 'border-rose-400' : 'border-slate-300')}
        />
        <span className="w-14 text-center text-xs tabular-nums text-slate-500" aria-live="polite">
          {count}
        </span>
        <Opt k="caseSensitive" label="대소문자 구분" icon={<CaseSensitive className="size-4" />} />
        <Opt k="wholeWord" label="낱말 단위" icon={<WholeWord className="size-4" />} />
        <Opt k="regex" label="정규식" icon={<Regex className="size-4" />} />
        <button type="button" aria-label="앞 결과" onClick={() => go(-1)} className="rounded p-1 text-slate-600 hover:bg-slate-100">
          <ChevronUp className="size-4" />
        </button>
        <button type="button" aria-label="다음 결과" onClick={() => go(1)} className="rounded p-1 text-slate-600 hover:bg-slate-100">
          <ChevronDown className="size-4" />
        </button>
        <button type="button" aria-label="찾기 닫기" onClick={close} className="rounded p-1 text-slate-600 hover:bg-slate-100">
          <X className="size-4" />
        </button>
      </div>
      {showReplace ? (
        <div className="mt-1.5 flex items-center gap-1">
          <input value={r} onChange={(e) => setR(e.target.value)} onKeyDown={(e) => key(e, () => editor && (editor.replace(r), setStatus(editor.findStatus())))} placeholder="바꿀 글" aria-label="바꿀 글" className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-[13px] outline-none focus:border-sky-500" />
          <Button onClick={() => editor && (editor.replace(r), setStatus(editor.findStatus()))}>바꾸기</Button>
          <Button
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
        <button type="button" onClick={() => setShowReplace(true)} className="mt-1 px-1 text-xs text-sky-700 hover:underline">
          바꾸기…
        </button>
      )}
      {note && <div className="mt-1 px-1 text-xs text-emerald-700">{note}</div>}
    </div>
  );
}

// ── 상태 줄 ───────────────────────────────────────────

export function StatusBar({ ui, count, message, input, engine }: { ui: Ui | null; count: WordCount | null; message: string; input: string; engine: string }) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-slate-200 bg-white px-4 text-xs text-slate-500">
      <span>{ui ? `${ui.pages.toLocaleString()}쪽` : '…'}</span>
      {ui && ui.section.count > 1 && <span>구역 {ui.section.index + 1}/{ui.section.count}</span>}
      {count && (
        <span>
          {count.chars.toLocaleString()}자 · {count.words.toLocaleString()}어절
        </span>
      )}
      {ui?.suggesting && <span className="text-emerald-700">제안 모드</span>}
      {ui && ui.viewMode !== 'suggestions' && <span className="text-amber-700">{ui.viewMode === 'final' ? '최종본 보기 (읽기 전용)' : '원본 보기 (읽기 전용)'}</span>}
      {ui?.spell && <span>맞춤법 검사 켜짐</span>}
      <span className="flex-1 truncate text-slate-700">{message}</span>
      <span title={engine}>{input}</span>
    </footer>
  );
}
