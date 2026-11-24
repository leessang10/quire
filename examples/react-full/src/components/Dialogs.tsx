/** 대화상자: 쪽 설정, 링크, 대체 텍스트, 글자 수, 단축키, 가져오기 보고, 이 예제에 대해 · 오른쪽 클릭 메뉴 */
import { useEffect, useRef, useState } from 'react';
import type { Editor, MenuItem as PluginMenuItem, SpellMenu, WordCount } from '@quiredoc/editor';
import { PAPERS, SHORTCUTS, applyPageForm, checkPageForm, pageFormOf, paperSize, type PageForm } from '../lib/quire-app';
import { Button, Dialog, Field, inputClass } from './ui';

// ── 쪽 설정 ───────────────────────────────────────────

export function PageSetupDialog({ editor, open, onClose }: { editor: Editor | null; open: boolean; onClose: () => void }) {
  const [f, setF] = useState<PageForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const info = open && editor ? editor.sectionInfo() : null;
  useEffect(() => {
    if (open && editor) {
      setF(pageFormOf(editor.sectionInfo().props));
      setErr(null);
    }
  }, [open, editor]);
  if (!f) return <Dialog open={false} title="" onClose={onClose}>{null}</Dialog>;
  const set = (patch: Partial<PageForm>) => {
    const next = { ...f, ...patch };
    // 용지·방향을 고르면 크기를 맞춘다. 사용자 지정이면 방향에 따라 너비·높이를 바꾼다
    if (patch.paper !== undefined || patch.orientation !== undefined) {
      const s = paperSize(next.paper, next.orientation);
      if (s) [next.width, next.height] = s;
      else if (patch.orientation !== undefined && (next.width > next.height) !== (next.orientation === 'landscape')) [next.width, next.height] = [next.height, next.width];
    }
    setF(next);
  };
  const num = (v: string) => Number(v);
  const ok = () => {
    const e = checkPageForm(f);
    if (e) return setErr(e);
    if (editor) applyPageForm(editor, f);
    onClose();
    editor?.focus();
  };
  return (
    <Dialog
      open={open}
      title={`쪽 설정${info && info.count > 1 ? ` · 구역 ${info.index + 1}/${info.count}` : ''}`}
      onClose={onClose}
      width="w-[520px]"
      footer={
        <>
          {info && info.index < info.count - 1 && (
            <Button
              variant="ghost"
              className="mr-auto text-rose-600"
              onClick={() => {
                editor?.removeSectionBreak();
                onClose();
              }}
            >
              이 구역 나눔 지우기
            </Button>
          )}
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={ok}>
            적용
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="용지">
          <select className={inputClass} value={f.paper} onChange={(e) => set({ paper: e.target.value })}>
            {PAPERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="custom">사용자 지정</option>
          </select>
        </Field>
        <Field label="방향">
          <div className="flex h-8 overflow-hidden rounded-md border border-slate-300">
            {(['portrait', 'landscape'] as const).map((o) => (
              <button key={o} type="button" onClick={() => set({ orientation: o })} className={'flex-1 text-[13px] ' + (f.orientation === o ? 'bg-sky-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
                {o === 'portrait' ? '세로' : '가로'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="너비 (mm)">
          <input type="number" className={inputClass} disabled={f.paper !== 'custom'} value={f.width} onChange={(e) => set({ width: num(e.target.value) })} />
        </Field>
        <Field label="높이 (mm)">
          <input type="number" className={inputClass} disabled={f.paper !== 'custom'} value={f.height} onChange={(e) => set({ height: num(e.target.value) })} />
        </Field>
      </div>
      <h3 className="mb-2 mt-4 text-xs font-semibold text-slate-500">여백 (mm)</h3>
      <div className="grid grid-cols-4 gap-2">
        {(['위', '오른쪽', '아래', '왼쪽'] as const).map((label, i) => (
          <Field key={label} label={label}>
            <input type="number" className={inputClass} value={f.margin[i]} onChange={(e) => set({ margin: f.margin.map((v, k) => (k === i ? num(e.target.value) : v)) as PageForm['margin'] })} />
          </Field>
        ))}
      </div>
      <h3 className="mb-2 mt-4 text-xs font-semibold text-slate-500">다단·구역·쪽 번호</h3>
      <div className="grid grid-cols-3 gap-2">
        <Field label="단 수">
          <select className={inputClass} value={f.columns} onChange={(e) => set({ columns: num(e.target.value) })}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}단
              </option>
            ))}
          </select>
        </Field>
        <Field label="단 사이 (mm)">
          <input type="number" className={inputClass} disabled={f.columns < 2} value={f.columnGap} onChange={(e) => set({ columnGap: num(e.target.value) })} />
        </Field>
        <label className="flex items-end gap-2 pb-1.5 text-[13px]">
          <input type="checkbox" disabled={f.columns < 2} checked={f.separator} onChange={(e) => set({ separator: e.target.checked })} /> 구분선
        </label>
        <Field label="구역 시작">
          <select className={inputClass} value={f.start} onChange={(e) => set({ start: e.target.value as PageForm['start'] })}>
            <option value="nextPage">다음 쪽</option>
            <option value="continuous">이어서</option>
            <option value="oddPage">홀수 쪽</option>
            <option value="evenPage">짝수 쪽</option>
          </select>
        </Field>
        <Field label="쪽 번호 시작">
          <input className={inputClass} placeholder="이어서" value={f.pageNumberStart} onChange={(e) => set({ pageNumberStart: e.target.value })} />
        </Field>
        <Field label="쪽 번호 모양">
          <select className={inputClass} value={f.pageNumberFormat} onChange={(e) => set({ pageNumberFormat: e.target.value as PageForm['pageNumberFormat'] })}>
            <option value="decimal">1, 2, 3</option>
            <option value="roman">i, ii, iii</option>
            <option value="hangul">가, 나, 다</option>
          </select>
        </Field>
      </div>
      {err && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>}
      <p className="mt-3 text-xs text-slate-400">지금 캐럿이 있는 구역에 적용합니다. 구역은 삽입 › 나누기 › 구역 나누기로 만듭니다.</p>
    </Dialog>
  );
}

// ── 글 한 줄 묻기 (링크, 대체 텍스트) ─────────────────

export function PromptDialog(props: { open: boolean; title: string; label: string; initial: string; placeholder?: string; okLabel?: string; removeLabel?: string; onSubmit: (v: string | null) => void; onClose: () => void; validate?: (v: string) => string | null }) {
  const [v, setV] = useState(props.initial);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.open) {
      setV(props.initial);
      setErr(null);
      setTimeout(() => ref.current?.select(), 0);
    }
  }, [props.open, props.initial]);
  const submit = () => {
    const e = props.validate?.(v) ?? null;
    if (e) return setErr(e);
    props.onSubmit(v);
    props.onClose();
  };
  return (
    <Dialog
      open={props.open}
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          {props.removeLabel && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                props.onSubmit(null);
                props.onClose();
              }}
            >
              {props.removeLabel}
            </Button>
          )}
          <Button onClick={props.onClose}>취소</Button>
          <Button variant="primary" onClick={submit}>
            {props.okLabel ?? '확인'}
          </Button>
        </>
      }
    >
      <Field label={props.label}>
        <input
          ref={ref}
          className={inputClass}
          value={v}
          placeholder={props.placeholder}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </Field>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </Dialog>
  );
}

// ── 알림형 대화상자 ───────────────────────────────────

export function WordCountDialog({ open, count, pages, onClose }: { open: boolean; count: WordCount | null; pages: number; onClose: () => void }) {
  const rows: Array<[string, string]> = count
    ? [
        ['쪽', pages.toLocaleString()],
        ['글자 (공백 포함)', count.chars.toLocaleString()],
        ['글자 (공백 제외)', count.charsNoSpace.toLocaleString()],
        ['어절', count.words.toLocaleString()],
        ['문단', count.paragraphs.toLocaleString()],
      ]
    : [];
  return (
    <Dialog open={open} title="글자 수" onClose={onClose} width="w-[340px]" footer={<Button variant="primary" onClick={onClose}>닫기</Button>}>
      <dl className="grid grid-cols-[1fr_auto] gap-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right font-medium tabular-nums text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-400">글자 수 플러그인(wordCountPlugin)이 센 값입니다. 머리말·각주는 빼고 본문만 셉니다.</p>
    </Dialog>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title="단축키" onClose={onClose} width="w-[480px]" footer={<Button variant="primary" onClick={onClose}>닫기</Button>}>
      <table className="w-full">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k} className="border-b border-slate-100 last:border-0">
              <td className="py-1.5 pr-4">
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{k}</kbd>
              </td>
              <td className="py-1.5 text-slate-700">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

export function NoticeDialog({ open, title, children, onClose }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog open={open} title={title} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>닫기</Button>}>
      {children}
    </Dialog>
  );
}

// ── 오른쪽 클릭 메뉴 ──────────────────────────────────

export interface ContextMenuState {
  x: number;
  y: number;
  spell: SpellMenu | null;
  items: PluginMenuItem[];
}

export function ContextMenu({ menu, onClose, onComment, onLink, hasSelection }: { menu: ContextMenuState | null; onClose: () => void; onComment: () => void; onLink: () => void; hasSelection: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [menu, onClose]);
  useEffect(() => {
    if (!menu || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(menu.x, innerWidth - r.width - 8), top: Math.min(menu.y, innerHeight - r.height - 8) });
  }, [menu]);
  if (!menu) return null;
  const item = (label: React.ReactNode, run: () => void, cls = '', disabled = false) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClose();
        run();
      }}
      className={'block w-full rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-slate-100 disabled:opacity-40 ' + cls}
    >
      {label}
    </button>
  );
  const s = menu.spell;
  return (
    <div ref={ref} role="menu" className="fixed z-50 min-w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-xl" style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}>
      {s && (
        <>
          <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-rose-600">{s.message ?? (s.kind === 'spacing' ? '띄어쓰기' : s.kind === 'grammar' ? '문법' : '맞춤법')}</div>
          {s.suggestions.map((g) => item(<b className="font-semibold">{g}</b>, () => s.apply(g)))}
          {!s.suggestions.length && item('고칠 말 없음', () => {}, 'text-slate-400', true)}
          {item('모두 무시', () => s.ignore())}
          {item('사전에 더하기', () => s.addWord())}
          <div className="my-1 h-px bg-slate-200" />
        </>
      )}
      {item('댓글 달기', onComment, '', !hasSelection)}
      {item('링크…', onLink)}
      {menu.items.length > 0 && <div className="my-1 h-px bg-slate-200" />}
      {menu.items.map((it, i) => (
        <div key={i}>{item(it.label, it.run, '', !!it.disabled)}</div>
      ))}
    </div>
  );
}
