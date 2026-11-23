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
import { useT } from '@/lib/i18n';
import type { AppMessageKey } from '@/lib/messages';

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
  const t = useT();
  const styleName = (id: string) => t(`style.${id}` as AppMessageKey);
  return (
    <div role="toolbar" aria-label={t('toolbar.label')} className="flex flex-wrap items-center gap-0.5 rounded-xl border bg-muted/40 px-2 py-1">
      <B label={t('edit.undo')} shortcut="Ctrl+Z" disabled={!ui?.canUndo} onClick={() => act((e) => e.undo())}>
        <Undo2 />
      </B>
      <B label={t('edit.redo')} shortcut="Ctrl+Y" disabled={!ui?.canRedo} onClick={() => act((e) => e.redo())}>
        <Redo2 />
      </B>
      <Sep />
      <Select items={STYLES.map((s) => ({ value: s.id, label: styleName(s.id) }))} value={p?.style ?? null} onValueChange={(v) => v && act((e) => e.setParagraphStyle(String(v)))}>
        <SelectTrigger size="sm" className="w-24 border-0 bg-transparent shadow-none" aria-label={t('toolbar.style')}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {STYLES.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              <span className={s.id === 'h1' ? 'text-base font-bold' : s.id === 'h2' ? 'font-bold' : s.id === 'h3' ? 'font-semibold' : s.id === 'quote' ? 'italic text-muted-foreground' : ''}>{styleName(s.id)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select items={FONTS.map((f) => ({ value: f, label: f }))} value={m?.font ?? null} onValueChange={(v) => v && act((e) => e.setMark('font', v === 'Pretendard' ? undefined : String(v)))}>
        <SelectTrigger size="sm" className="w-32 border-0 bg-transparent shadow-none" aria-label={t('toolbar.font')}>
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
      <B label={t('toolbar.smaller')} onClick={() => setSize((size ?? 12) - 1)}>
        <Minus />
      </B>
      <SizeInput value={size} onChange={setSize} />
      <B label={t('toolbar.larger')} onClick={() => setSize((size ?? 12) + 1)}>
        <Plus />
      </B>
      <Sep />
      <T label={t('attr.bold')} shortcut="Ctrl+B" pressed={m?.bold} onClick={() => act((e) => e.toggleMark('bold'))}>
        <Bold />
      </T>
      <T label={t('attr.italic')} shortcut="Ctrl+I" pressed={m?.italic} onClick={() => act((e) => e.toggleMark('italic'))}>
        <Italic />
      </T>
      <T label={t('attr.underline')} shortcut="Ctrl+U" pressed={m?.underline} onClick={() => act((e) => e.toggleMark('underline'))}>
        <Underline />
      </T>
      <T label={t('attr.strike')} pressed={m?.strike} onClick={() => act((e) => e.toggleMark('strike'))}>
        <Strikethrough />
      </T>
      <ColorPopover label={t('toolbar.color')} icon={<Baseline />} value={m?.color ?? null} colors={COLORS} none={t('toolbar.defaultColor')} onPick={(c) => act((e) => e.setMark('color', c ?? undefined))} />
      <ColorPopover label={t('toolbar.highlight')} icon={<Highlighter />} value={m?.highlight ?? null} colors={HIGHLIGHTS} none={t('toolbar.none')} onPick={(c) => act((e) => e.setMark('highlight', c ?? undefined))} />
      <T label={t('attr.sup')} pressed={m?.script === null ? null : m?.script === 'sup'} onClick={() => act((e) => e.toggleScript('sup'))}>
        <Superscript />
      </T>
      <T label={t('attr.sub')} pressed={m?.script === null ? null : m?.script === 'sub'} onClick={() => act((e) => e.toggleScript('sub'))}>
        <Subscript />
      </T>
      <Sep />
      <T label={t('toolbar.link')} pressed={!!m?.link} onClick={onLink}>
        <Link2 />
      </T>
      <B label={t('toolbar.image')} onClick={onImage}>
        <ImagePlus />
      </B>
      <TablePopover onPick={(r, c) => act((e) => e.insertTable(r, c))} />
      <Sep />
      {(
        [
          ['left', 'toolbar.alignLeft', AlignLeft],
          ['center', 'toolbar.alignCenter', AlignCenter],
          ['right', 'toolbar.alignRight', AlignRight],
          ['justify', 'toolbar.alignJustify', AlignJustify],
        ] as const
      ).map(([a, label, Icon]) => (
        <T key={a} label={t(label)} pressed={p?.align === null ? null : p?.align === a} onClick={() => act((e) => e.setParagraphAttr('align', a === 'left' ? undefined : a))}>
          <Icon />
        </T>
      ))}
      <DropdownMenu>
        <Tip label={t('toolbar.lineSpacing')}>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-0.5 px-2 tabular-nums" {...keep} />}>
            {p?.line ?? '—'}
            <ChevronDown className="size-3 opacity-60" />
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent className="w-36">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('toolbar.lineSpacing')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={p?.line ?? undefined} onValueChange={(v) => act((e) => e.setParagraphAttr('line', v === 1 ? undefined : { rule: 'multiple', value: Number(v) }))}>
              {LINE_SPACINGS.map((v) => (
                <DropdownMenuRadioItem key={v} value={v}>
                  {v === 1 ? t('toolbar.single') : v}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <T label={t('toolbar.bullets')} shortcut="Ctrl+Shift+8" pressed={p?.list === 'bullet'} onClick={() => act((e) => e.toggleList('bullet'))}>
        <List />
      </T>
      <T label={t('toolbar.numbers')} shortcut="Ctrl+Shift+7" pressed={p?.list === 'number'} onClick={() => act((e) => e.toggleList('number'))}>
        <ListOrdered />
      </T>
      <B label={t('toolbar.outdent')} shortcut="Shift+Tab" onClick={() => act((e) => e.indent(-1))}>
        <IndentDecrease />
      </B>
      <B label={t('toolbar.indent')} shortcut="Tab" onClick={() => act((e) => e.indent(1))}>
        <IndentIncrease />
      </B>
      <B label={t('format.clear')} onClick={() => act((e) => e.clearMarks())}>
        <RemoveFormatting />
      </B>
      <div className="ml-auto" />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant={ui?.suggesting ? 'secondary' : 'ghost'} size="sm" className={cn('gap-1.5', ui?.suggesting && 'text-emerald-700')} {...keep} />}>
          {ui?.suggesting ? <PencilLine /> : <Eye className="opacity-0 -mr-4" />}
          {ui?.suggesting ? t('toolbar.modeSuggest') : t('toolbar.modeEdit')}
          <ChevronDown className="size-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('toolbar.mode')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={ui?.suggesting ? 'suggest' : 'edit'} onValueChange={(v) => act((e) => e.setSuggesting(v === 'suggest'))}>
              <DropdownMenuRadioItem value="edit">{t('toolbar.modeEditLong')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="suggest">{t('toolbar.modeSuggestLong')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('menu.view')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={ui?.viewMode ?? 'suggestions'} onValueChange={(v) => act((e) => e.setViewMode(v as 'suggestions'))}>
              <DropdownMenuRadioItem value="suggestions">{t('view.suggestions')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="final">{t('view.finalLong')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="original">{t('view.originalLong')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SizeInput({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const t = useT();
  return (
    <input
      aria-label={t('toolbar.size')}
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
  const t = useT();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label={t('toolbar.table')}>
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('toolbar.table')} {...keep} />}>
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
                aria-label={t('toolbar.tableCell', { rows: r, cols: c })}
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
        <div className="mt-1.5 text-center text-xs text-muted-foreground">{hover[0] ? `${hover[0]} × ${hover[1]}` : t('toolbar.tablePick')}</div>
      </PopoverContent>
    </Popover>
  );
}
