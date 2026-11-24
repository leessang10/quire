/** 도구 막대 (Google Docs식 한 줄): 자주 쓰는 글자·문단 서식과 넣기 */
import { useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Eye,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  PencilLine,
  Plus,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Underline,
  Undo2,
} from 'lucide-react';
import type { Editor } from '@quiredoc/editor';
import { COLORS, FONTS, HIGHLIGHTS, LINE_SPACINGS, SIZES, STYLES, type Ui } from '../lib/quire-app';
import { Divider, Dropdown, MenuItem, MenuLabel, MenuSeparator, ToolButton } from './ui';

type Act = (f: (e: Editor) => unknown) => void;

export function Toolbar({ ui, act, onLink, onImage }: { ui: Ui | null; act: Act; onLink: () => void; onImage: () => void }) {
  const m = ui?.marks;
  const p = ui?.para;
  const size = m?.size ?? null;
  const setSize = (v: number) => act((e) => e.setMark('size', Math.round(Math.max(1, Math.min(400, v)) * 1000)));
  const styleLabel = STYLES.find((s) => s.id === p?.style)?.label ?? (p?.style === null ? '—' : (p?.style ?? '본문'));
  return (
    <div role="toolbar" aria-label="서식" className="flex flex-wrap items-center gap-0.5 rounded-full bg-slate-100 px-3 py-1">
      <ToolButton label="실행 취소" shortcut="Ctrl+Z" disabled={!ui?.canUndo} onClick={() => act((e) => e.undo())}>
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton label="다시 실행" shortcut="Ctrl+Y" disabled={!ui?.canRedo} onClick={() => act((e) => e.redo())}>
        <Redo2 className="size-4" />
      </ToolButton>
      <Divider />
      <Dropdown label="문단 스타일" trigger={<span className="w-16 truncate text-left">{styleLabel}</span>}>
        {STYLES.map((s) => (
          <MenuItem key={s.id} checked={p?.style === s.id} onSelect={() => act((e) => e.setParagraphStyle(s.id))}>
            <span className={s.id === 'h1' ? 'text-lg font-bold' : s.id === 'h2' ? 'text-base font-bold' : s.id === 'h3' ? 'font-semibold' : s.id === 'quote' ? 'italic text-slate-500' : ''}>{s.label}</span>
          </MenuItem>
        ))}
      </Dropdown>
      <Divider />
      <Dropdown label="글꼴" trigger={<span className="w-24 truncate text-left">{m?.font ?? '—'}</span>}>
        {FONTS.map((f) => (
          <MenuItem key={f} checked={m?.font === f} onSelect={() => act((e) => e.setMark('font', f === 'Pretendard' ? undefined : f))}>
            <span style={{ fontFamily: f }}>{f}</span>
          </MenuItem>
        ))}
      </Dropdown>
      <Divider />
      <ToolButton label="글자 작게" onClick={() => setSize((size ?? 12) - 1)}>
        <Minus className="size-3.5" />
      </ToolButton>
      <SizeBox value={size} onChange={setSize} />
      <ToolButton label="글자 크게" onClick={() => setSize((size ?? 12) + 1)}>
        <Plus className="size-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton label="굵게" shortcut="Ctrl+B" pressed={m?.bold} onClick={() => act((e) => e.toggleMark('bold'))}>
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton label="기울임" shortcut="Ctrl+I" pressed={m?.italic} onClick={() => act((e) => e.toggleMark('italic'))}>
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton label="밑줄" shortcut="Ctrl+U" pressed={m?.underline} onClick={() => act((e) => e.toggleMark('underline'))}>
        <Underline className="size-4" />
      </ToolButton>
      <ToolButton label="취소선" pressed={m?.strike} onClick={() => act((e) => e.toggleMark('strike'))}>
        <Strikethrough className="size-4" />
      </ToolButton>
      <ColorMenu label="글자색" icon={<Baseline className="size-4" />} value={m?.color ?? null} colors={COLORS} onPick={(c) => act((e) => e.setMark('color', c ?? undefined))} noneLabel="기본 색" />
      <ColorMenu label="형광펜" icon={<Highlighter className="size-4" />} value={m?.highlight ?? null} colors={HIGHLIGHTS} onPick={(c) => act((e) => e.setMark('highlight', c ?? undefined))} noneLabel="없음" />
      <ToolButton label="위 첨자" pressed={m?.script === null ? null : m?.script === 'sup'} onClick={() => act((e) => e.toggleScript('sup'))}>
        <Superscript className="size-4" />
      </ToolButton>
      <ToolButton label="아래 첨자" pressed={m?.script === null ? null : m?.script === 'sub'} onClick={() => act((e) => e.toggleScript('sub'))}>
        <Subscript className="size-4" />
      </ToolButton>
      <Divider />
      <ToolButton label="링크" pressed={!!m?.link} onClick={onLink}>
        <Link2 className="size-4" />
      </ToolButton>
      <ToolButton label="그림 넣기" onClick={onImage}>
        <ImagePlus className="size-4" />
      </ToolButton>
      <TablePicker onPick={(r, c) => act((e) => e.insertTable(r, c))} />
      <Divider />
      {(
        [
          ['left', '왼쪽 정렬', AlignLeft],
          ['center', '가운데 정렬', AlignCenter],
          ['right', '오른쪽 정렬', AlignRight],
          ['justify', '양쪽 정렬', AlignJustify],
        ] as const
      ).map(([a, label, Icon]) => (
        <ToolButton key={a} label={label} pressed={p?.align === null ? null : p?.align === a} onClick={() => act((e) => e.setParagraphAttr('align', a === 'left' ? undefined : a))}>
          <Icon className="size-4" />
        </ToolButton>
      ))}
      <Dropdown label="줄 간격" trigger={<span className="tabular-nums">{p?.line ?? '—'}</span>} width="min-w-36">
        <MenuLabel>줄 간격</MenuLabel>
        {LINE_SPACINGS.map((v) => (
          <MenuItem key={v} checked={p?.line === v} onSelect={() => act((e) => e.setParagraphAttr('line', v === 1 ? undefined : { rule: 'multiple', value: v }))}>
            {v === 1 ? '1 (한 줄)' : v}
          </MenuItem>
        ))}
      </Dropdown>
      <ToolButton label="글머리 목록" shortcut="Ctrl+Shift+8" pressed={p?.list === 'bullet'} onClick={() => act((e) => e.toggleList('bullet'))}>
        <List className="size-4" />
      </ToolButton>
      <ToolButton label="번호 목록" shortcut="Ctrl+Shift+7" pressed={p?.list === 'number'} onClick={() => act((e) => e.toggleList('number'))}>
        <ListOrdered className="size-4" />
      </ToolButton>
      <ToolButton label="내어쓰기" shortcut="Shift+Tab" onClick={() => act((e) => e.indent(-1))}>
        <IndentDecrease className="size-4" />
      </ToolButton>
      <ToolButton label="들여쓰기" shortcut="Tab" onClick={() => act((e) => e.indent(1))}>
        <IndentIncrease className="size-4" />
      </ToolButton>
      <ToolButton label="서식 지우기" onClick={() => act((e) => e.clearMarks())}>
        <RemoveFormatting className="size-4" />
      </ToolButton>
      <div className="ml-auto" />
      <Dropdown
        label="편집 모드"
        trigger={
          <span className="flex items-center gap-1.5">
            {ui?.suggesting ? <PencilLine className="size-4 text-emerald-700" /> : <Eye className="hidden" />}
            {ui?.suggesting ? <span className="text-emerald-700">제안</span> : <span>편집</span>}
          </span>
        }
        width="min-w-64"
      >
        <MenuItem checked={!ui?.suggesting} onSelect={() => act((e) => e.setSuggesting(false))}>
          편집 <span className="text-xs text-slate-400">· 문서를 바로 고친다</span>
        </MenuItem>
        <MenuItem checked={!!ui?.suggesting} onSelect={() => act((e) => e.setSuggesting(true))}>
          제안 <span className="text-xs text-slate-400">· 고친 것이 제안으로 남는다</span>
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>보기</MenuLabel>
        <MenuItem checked={ui?.viewMode === 'suggestions'} onSelect={() => act((e) => e.setViewMode('suggestions'))}>
          제안 표시
        </MenuItem>
        <MenuItem checked={ui?.viewMode === 'final'} onSelect={() => act((e) => e.setViewMode('final'))}>
          최종본 (모두 수락한 모양)
        </MenuItem>
        <MenuItem checked={ui?.viewMode === 'original'} onSelect={() => act((e) => e.setViewMode('original'))}>
          원본 (모두 거부한 모양)
        </MenuItem>
      </Dropdown>
    </div>
  );
}

/** 글자 크기 칸: 숫자를 쳐서 Enter */
function SizeBox({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label="글자 크기 (pt)"
      className="h-7 w-10 rounded border border-slate-300 bg-white text-center text-[13px] tabular-nums outline-none focus:border-sky-500"
      value={draft ?? (value === null ? '' : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const v = Number(draft);
          if (Number.isFinite(v) && v > 0) onChange(v);
          setDraft(null);
        } else if (e.key === 'Escape') setDraft(null);
      }}
      onBlur={() => setDraft(null)}
      list="quire-sizes"
    />
  );
}

export function SizeList() {
  return (
    <datalist id="quire-sizes">
      {SIZES.map((s) => (
        <option key={s} value={s} />
      ))}
    </datalist>
  );
}

function ColorMenu(props: { label: string; icon: React.ReactNode; value: string | null; colors: string[]; noneLabel: string; onPick: (c: string | null) => void }) {
  return (
    <Dropdown
      label={props.label}
      trigger={
        <span className="flex flex-col items-center">
          {props.icon}
          <span className="-mt-0.5 h-1 w-4 rounded-sm" style={{ background: props.value ?? 'transparent', outline: props.value ? undefined : '1px solid #cbd5e1' }} />
        </span>
      }
      width="w-48"
    >
      <div className="grid grid-cols-8 gap-1 p-1">
        {props.colors.map((c) => (
          <ColorSwatch key={c} color={c} active={props.value === c} onPick={() => props.onPick(c)} />
        ))}
      </div>
      <MenuSeparator />
      <MenuItem onSelect={() => props.onPick(null)}>{props.noneLabel}</MenuItem>
    </Dropdown>
  );
}

function ColorSwatch({ color, active, onPick }: { color: string; active: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      title={color}
      aria-label={color}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
        // 메뉴를 닫는다 (바깥 클릭과 같게)
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }}
      className={'size-5 rounded-full border ' + (active ? 'ring-2 ring-sky-500 ring-offset-1' : 'border-slate-300')}
      style={{ background: color }}
    />
  );
}

/** 표 넣기: 칸을 끌어 행·열 고르기 */
function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  return (
    <Dropdown label="표 넣기" trigger={<Table className="size-4" />} width="w-auto">
      <div className="p-2" onMouseLeave={() => setHover([0, 0])}>
        <div className="grid grid-cols-8 gap-0.5">
          {Array.from({ length: 64 }, (_, i) => {
            const r = Math.floor(i / 8) + 1;
            const c = (i % 8) + 1;
            const on = r <= hover[0] && c <= hover[1];
            return (
              <button
                key={i}
                type="button"
                aria-label={`${r}×${c} 표`}
                onMouseEnter={() => setHover([r, c])}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(r, c);
                  document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                }}
                className={'size-4 rounded-[3px] border ' + (on ? 'border-sky-500 bg-sky-100' : 'border-slate-300 bg-white')}
              />
            );
          })}
        </div>
        <div className="mt-1.5 text-center text-xs text-slate-500">{hover[0] ? `${hover[0]} × ${hover[1]}` : '표 크기 고르기'}</div>
      </div>
    </Dropdown>
  );
}
