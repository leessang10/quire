'use client';
/** 도구 막대: shadcn Toggle·Select·Popover·Tooltip으로 만든 한 줄 */
import { useState, type ReactElement, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
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
  ChevronDown,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import type { Act } from '@/lib/use-ui';
import { COLORS, FONTS, HIGHLIGHTS, LINE_SPACINGS, STYLES, type Ui } from '@/lib/quire-app';

/** 편집기 포커스를 빼앗지 않게 mousedown을 막는다 */
const keep = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

function Tip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>
        {label}
        {shortcut && <Kbd className="ml-1.5">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function T(props: { label: string; shortcut?: string; pressed?: boolean | null; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tip label={props.label} shortcut={props.shortcut}>
      <Toggle size="sm" aria-label={props.label} pressed={!!props.pressed} disabled={props.disabled} onPressedChange={() => props.onClick()} {...keep} className={cn(props.pressed === null && 'bg-muted/50')}>
        {props.children}
      </Toggle>
    </Tip>
  );
}

function B(props: { label: string; shortcut?: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tip label={props.label} shortcut={props.shortcut}>
      <Button variant="ghost" size="icon-sm" aria-label={props.label} disabled={props.disabled} onClick={props.onClick} {...keep}>
        {props.children}
      </Button>
    </Tip>
  );
}

const Sep = () => <Separator orientation="vertical" className="mx-1 h-5!" />;

export function Toolbar({ ui, act, onLink, onImage }: { ui: Ui | null; act: Act; onLink: () => void; onImage: () => void }) {
  const m = ui?.marks;
  const p = ui?.para;
  const size = m?.size ?? null;
  const setSize = (v: number) => act((e) => e.setMark('size', Math.round(Math.max(1, Math.min(400, v)) * 1000)));
  return (
    <div role="toolbar" aria-label="서식" className="flex flex-wrap items-center gap-0.5 rounded-xl border bg-muted/40 px-2 py-1">
      <B label="실행 취소" shortcut="Ctrl+Z" disabled={!ui?.canUndo} onClick={() => act((e) => e.undo())}>
        <Undo2 />
      </B>
      <B label="다시 실행" shortcut="Ctrl+Y" disabled={!ui?.canRedo} onClick={() => act((e) => e.redo())}>
        <Redo2 />
      </B>
      <Sep />
      <Select items={STYLES.map((s) => ({ value: s.id, label: s.label }))} value={p?.style ?? null} onValueChange={(v) => v && act((e) => e.setParagraphStyle(String(v)))}>
        <SelectTrigger size="sm" className="w-24 border-0 bg-transparent shadow-none" aria-label="문단 스타일">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {STYLES.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              <span className={s.id === 'h1' ? 'text-base font-bold' : s.id === 'h2' ? 'font-bold' : s.id === 'h3' ? 'font-semibold' : s.id === 'quote' ? 'italic text-muted-foreground' : ''}>{s.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select items={FONTS.map((f) => ({ value: f, label: f }))} value={m?.font ?? null} onValueChange={(v) => v && act((e) => e.setMark('font', v === 'Pretendard' ? undefined : String(v)))}>
        <SelectTrigger size="sm" className="w-32 border-0 bg-transparent shadow-none" aria-label="글꼴">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {FONTS.map((f) => (
            <SelectItem key={f} value={f}>
              <span style={{ fontFamily: f }}>{f}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Sep />
      <B label="글자 작게" onClick={() => setSize((size ?? 12) - 1)}>
        <Minus />
      </B>
      <SizeInput value={size} onChange={setSize} />
      <B label="글자 크게" onClick={() => setSize((size ?? 12) + 1)}>
        <Plus />
      </B>
      <Sep />
      <T label="굵게" shortcut="Ctrl+B" pressed={m?.bold} onClick={() => act((e) => e.toggleMark('bold'))}>
        <Bold />
      </T>
      <T label="기울임" shortcut="Ctrl+I" pressed={m?.italic} onClick={() => act((e) => e.toggleMark('italic'))}>
        <Italic />
      </T>
      <T label="밑줄" shortcut="Ctrl+U" pressed={m?.underline} onClick={() => act((e) => e.toggleMark('underline'))}>
        <Underline />
      </T>
      <T label="취소선" pressed={m?.strike} onClick={() => act((e) => e.toggleMark('strike'))}>
        <Strikethrough />
      </T>
      <ColorPopover label="글자색" icon={<Baseline />} value={m?.color ?? null} colors={COLORS} none="기본 색" onPick={(c) => act((e) => e.setMark('color', c ?? undefined))} />
      <ColorPopover label="형광펜" icon={<Highlighter />} value={m?.highlight ?? null} colors={HIGHLIGHTS} none="없음" onPick={(c) => act((e) => e.setMark('highlight', c ?? undefined))} />
      <T label="위 첨자" pressed={m?.script === null ? null : m?.script === 'sup'} onClick={() => act((e) => e.toggleScript('sup'))}>
        <Superscript />
      </T>
      <T label="아래 첨자" pressed={m?.script === null ? null : m?.script === 'sub'} onClick={() => act((e) => e.toggleScript('sub'))}>
        <Subscript />
      </T>
      <Sep />
      <T label="링크" pressed={!!m?.link} onClick={onLink}>
        <Link2 />
      </T>
      <B label="그림 넣기" onClick={onImage}>
        <ImagePlus />
      </B>
      <TablePopover onPick={(r, c) => act((e) => e.insertTable(r, c))} />
      <Sep />
      {(
        [
          ['left', '왼쪽 정렬', AlignLeft],
          ['center', '가운데 정렬', AlignCenter],
          ['right', '오른쪽 정렬', AlignRight],
          ['justify', '양쪽 정렬', AlignJustify],
        ] as const
      ).map(([a, label, Icon]) => (
        <T key={a} label={label} pressed={p?.align === null ? null : p?.align === a} onClick={() => act((e) => e.setParagraphAttr('align', a === 'left' ? undefined : a))}>
          <Icon />
        </T>
      ))}
      <DropdownMenu>
        <Tip label="줄 간격">
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-0.5 px-2 tabular-nums" {...keep} />}>
            {p?.line ?? '—'}
            <ChevronDown className="size-3 opacity-60" />
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent className="w-36">
          <DropdownMenuGroup>
            <DropdownMenuLabel>줄 간격</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={p?.line ?? undefined} onValueChange={(v) => act((e) => e.setParagraphAttr('line', v === 1 ? undefined : { rule: 'multiple', value: Number(v) }))}>
              {LINE_SPACINGS.map((v) => (
                <DropdownMenuRadioItem key={v} value={v}>
                  {v === 1 ? '1 (한 줄)' : v}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <T label="글머리 목록" shortcut="Ctrl+Shift+8" pressed={p?.list === 'bullet'} onClick={() => act((e) => e.toggleList('bullet'))}>
        <List />
      </T>
      <T label="번호 목록" shortcut="Ctrl+Shift+7" pressed={p?.list === 'number'} onClick={() => act((e) => e.toggleList('number'))}>
        <ListOrdered />
      </T>
      <B label="내어쓰기" shortcut="Shift+Tab" onClick={() => act((e) => e.indent(-1))}>
        <IndentDecrease />
      </B>
      <B label="들여쓰기" shortcut="Tab" onClick={() => act((e) => e.indent(1))}>
        <IndentIncrease />
      </B>
      <B label="서식 지우기" onClick={() => act((e) => e.clearMarks())}>
        <RemoveFormatting />
      </B>
      <div className="ml-auto" />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant={ui?.suggesting ? 'secondary' : 'ghost'} size="sm" className={cn('gap-1.5', ui?.suggesting && 'text-emerald-700')} {...keep} />}>
          {ui?.suggesting ? <PencilLine /> : <Eye className="opacity-0 -mr-4" />}
          {ui?.suggesting ? '제안' : '편집'}
          <ChevronDown className="size-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>모드</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={ui?.suggesting ? 'suggest' : 'edit'} onValueChange={(v) => act((e) => e.setSuggesting(v === 'suggest'))}>
              <DropdownMenuRadioItem value="edit">편집 · 문서를 바로 고친다</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="suggest">제안 · 고친 것이 제안으로 남는다</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>보기</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={ui?.viewMode ?? 'suggestions'} onValueChange={(v) => act((e) => e.setViewMode(v as 'suggestions'))}>
              <DropdownMenuRadioItem value="suggestions">제안 표시</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="final">최종본 (모두 수락한 모양)</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="original">원본 (모두 거부한 모양)</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SizeInput({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label="글자 크기 (pt)"
      className="h-7 w-10 rounded-md border bg-background text-center text-sm tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
    />
  );
}

function ColorPopover(props: { label: string; icon: ReactNode; value: string | null; colors: string[]; none: string; onPick: (c: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (c: string | null) => {
    setOpen(false);
    props.onPick(c);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label={props.label}>
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={props.label} className="flex-col gap-0" {...keep} />}>
          {props.icon}
          <span className="-mt-0.5 h-1 w-4 rounded-sm" style={{ background: props.value ?? 'transparent', outline: props.value ? undefined : '1px solid var(--border)' }} />
        </PopoverTrigger>
      </Tip>
      <PopoverContent className="w-52 gap-2 p-2" initialFocus={false} finalFocus={false}>
        <div className="grid grid-cols-8 gap-1">
          {props.colors.map((c) => (
            <button key={c} type="button" title={c} aria-label={c} {...keep} onClick={() => pick(c)} className={cn('size-5 rounded-full border', props.value === c && 'ring-2 ring-ring ring-offset-1')} style={{ background: c }} />
          ))}
        </div>
        <Button variant="ghost" size="sm" className="justify-start" {...keep} onClick={() => pick(null)}>
          {props.none}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function TablePopover({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<[number, number]>([0, 0]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="표 넣기">
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="표 넣기" {...keep} />}>
          <Table />
        </PopoverTrigger>
      </Tip>
      <PopoverContent className="w-auto p-2" initialFocus={false} finalFocus={false}>
        <div className="grid grid-cols-8 gap-0.5" onMouseLeave={() => setHover([0, 0])}>
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
                {...keep}
                onClick={() => {
                  setOpen(false);
                  onPick(r, c);
                }}
                className={cn('size-4 rounded-[3px] border', on ? 'border-primary bg-primary/15' : 'bg-background')}
              />
            );
          })}
        </div>
        <div className="mt-1.5 text-center text-xs text-muted-foreground">{hover[0] ? `${hover[0]} × ${hover[1]}` : '표 크기 고르기'}</div>
      </PopoverContent>
    </Popover>
  );
}
