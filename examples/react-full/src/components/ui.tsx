/**
 * 작은 UI 조각: 도구 단추, 내림 메뉴, 메뉴 막대, 대화상자. 편집기에서 포커스를 빼앗지 않도록 도구 단추는 mousedown을 막는다.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** 도구 막대 단추 (눌림 상태가 있으면 aria-pressed) */
export function ToolButton(props: { label: string; shortcut?: string; pressed?: boolean | null; disabled?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  const { label, shortcut, pressed, disabled, onClick, children, className } = props;
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed === null ? 'mixed' : pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-[13px] text-slate-700 transition-colors',
        'hover:bg-slate-200/70 disabled:pointer-events-none disabled:opacity-40',
        pressed && 'bg-sky-100 text-sky-800 hover:bg-sky-200/70',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-slate-300" aria-hidden />;
}

// ── 내림 메뉴 ─────────────────────────────────────────

interface MenuCtx {
  close: () => void;
}
const MenuContext = createContext<MenuCtx>({ close: () => {} });

/** 바깥을 누르거나 Esc면 닫힌다 */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, close, ref]);
}

/** 도구 막대의 내림 단추 (글꼴, 색, 표 고르기 등) */
export function Dropdown(props: { label: string; trigger: ReactNode; children: ReactNode; width?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(open, close, ref);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={props.label}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
        className={cx('inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[13px] text-slate-700 hover:bg-slate-200/70', open && 'bg-slate-200/70', props.className)}
      >
        {props.trigger}
        <ChevronDown className="size-3.5 text-slate-500" />
      </button>
      {open && (
        <MenuContext.Provider value={{ close }}>
          <div role="menu" className={cx('absolute left-0 top-9 z-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg', props.width ?? 'min-w-44')}>
            {props.children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

/** 메뉴 항목 */
export function MenuItem(props: { onSelect: () => void; children: ReactNode; shortcut?: string; checked?: boolean; disabled?: boolean; icon?: ReactNode }) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      role={props.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={props.checked}
      disabled={props.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        close();
        props.onSelect();
      }}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-slate-800 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-slate-500">{props.checked ? <Check className="size-4 text-sky-700" /> : props.icon}</span>
      <span className="flex-1 truncate">{props.children}</span>
      {props.shortcut && <span className="pl-4 text-xs text-slate-400">{props.shortcut}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-slate-200" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{children}</div>;
}

/** 하위 메뉴 (마우스를 올리면 열린다) */
export function SubMenu(props: { label: string; icon?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-slate-800 hover:bg-slate-100" aria-haspopup="menu" aria-expanded={open}>
        <span className="flex size-4 shrink-0 items-center justify-center text-slate-500">{props.icon}</span>
        <span className="flex-1">{props.label}</span>
        <ChevronRight className="size-3.5 text-slate-400" />
      </div>
      {open && <div className="absolute left-full top-0 z-50 min-w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">{props.children}</div>}
    </div>
  );
}

// ── 메뉴 막대 (파일·수정·보기 …) ───────────────────────

const BarContext = createContext<{ open: string | null; setOpen: (k: string | null) => void }>({ open: null, setOpen: () => {} });

export function MenuBar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open !== null, () => setOpen(null), ref);
  return (
    <BarContext.Provider value={{ open, setOpen }}>
      <div ref={ref} role="menubar" className="flex items-center gap-0.5">
        {children}
      </div>
    </BarContext.Provider>
  );
}

/** 메뉴 막대의 메뉴 하나. 하나가 열려 있으면 마우스만 올려도 옮겨 간다 */
export function BarMenu({ label, children }: { label: string; children: ReactNode }) {
  const { open, setOpen } = useContext(BarContext);
  const isOpen = open === label;
  return (
    <div className="relative">
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(isOpen ? null : label)}
        onMouseEnter={() => open !== null && setOpen(label)}
        className={cx('rounded px-2 py-0.5 text-[13px] text-slate-700 hover:bg-slate-200/70', isOpen && 'bg-slate-200/70')}
      >
        {label}
      </button>
      {isOpen && (
        <MenuContext.Provider value={{ close: () => setOpen(null) }}>
          <div role="menu" className="absolute left-0 top-7 z-40 min-w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

// ── 대화상자 ──────────────────────────────────────────

export function Dialog(props: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      onCancel={props.onClose}
      className={cx('m-auto rounded-xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/30', props.width ?? 'w-[440px]')}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="text-[15px] font-semibold text-slate-900">{props.title}</h2>
        <button type="button" aria-label="닫기" onClick={props.onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
          <X className="size-4" />
        </button>
      </div>
      <div className="px-5 py-4 text-[13px] text-slate-700">{props.children}</div>
      {props.footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{props.footer}</div>}
    </dialog>
  );
}

export function Button(props: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'outline'; type?: 'button' | 'submit'; disabled?: boolean; className?: string; title?: string }) {
  const v = props.variant ?? 'outline';
  return (
    <button
      type={props.type ?? 'button'}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-40',
        v === 'primary' && 'bg-sky-600 text-white hover:bg-sky-700',
        v === 'outline' && 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        v === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1', props.className)}>
      <span className="text-xs font-medium text-slate-500">{props.label}</span>
      {props.children}
    </label>
  );
}

export const inputClass = 'h-8 rounded-md border border-slate-300 bg-white px-2 text-[13px] text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50 disabled:text-slate-400';
