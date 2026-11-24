'use client';
/** 대화상자 (shadcn Dialog): 쪽 설정, 글 한 줄 묻기(링크·대체 텍스트), 글자 수, 단축키, 알림 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Editor, WordCount } from '@quiredoc/editor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PAPERS, applyPageForm, checkPageForm, pageFormOf, paperSize, type PageForm } from '@/lib/quire-app';
import { useT } from '@/lib/i18n';
import type { AppMessageKey } from '@/lib/messages';

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={'grid gap-1.5 ' + (className ?? '')}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Choice<T extends string>({ value, items, onChange, label }: { value: T; items: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <Select items={items} value={value} onValueChange={(v) => v && onChange(v as T)}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── 쪽 설정 ───────────────────────────────────────────

export function PageSetupDialog({ editor, open, onClose }: { editor: Editor | null; open: boolean; onClose: () => void }) {
  const [f, setF] = useState<PageForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const info = open && editor ? editor.sectionInfo() : null;
  const t = useT();
  useEffect(() => {
    if (open && editor) {
      setF(pageFormOf(editor.sectionInfo().props));
      setErr(null);
    }
  }, [open, editor]);
  const set = (patch: Partial<PageForm>) => {
    if (!f) return;
    const next = { ...f, ...patch };
    if (patch.paper !== undefined || patch.orientation !== undefined) {
      const s = paperSize(next.paper, next.orientation);
      if (s) [next.width, next.height] = s;
      else if (patch.orientation !== undefined && (next.width > next.height) !== (next.orientation === 'landscape')) [next.width, next.height] = [next.height, next.width];
    }
    setF(next);
  };
  const ok = () => {
    if (!f) return;
    const e = checkPageForm(f, { negative: t('page.errNegative'), tooSmall: t('page.errTooSmall') });
    if (e) return setErr(e);
    if (editor) applyPageForm(editor, f);
    onClose();
    setTimeout(() => editor?.focus(), 0);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('page.title')}</DialogTitle>
          <DialogDescription>{info && info.count > 1 ? t('page.section', { index: info.index + 1, count: info.count }) : t('page.whole')}</DialogDescription>
        </DialogHeader>
        {f && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('page.paper')}>
                <Choice label={t('page.paper')} value={f.paper} onChange={(paper) => set({ paper })} items={[...PAPERS.map((p) => ({ value: p, label: p })), { value: 'custom', label: t('page.custom') }]} />
              </Field>
              <Field label={t('page.orientation')}>
                <ToggleGroup variant="outline" spacing={0} className="w-full" value={[f.orientation]} onValueChange={(v) => v[0] && set({ orientation: v[0] as PageForm['orientation'] })}>
                  <ToggleGroupItem value="portrait" className="flex-1">
                    {t('page.portrait')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="landscape" className="flex-1">
                    {t('page.landscape')}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field label={t('page.width')}>
                <Input type="number" disabled={f.paper !== 'custom'} value={f.width} onChange={(e) => set({ width: Number(e.target.value) })} />
              </Field>
              <Field label={t('page.height')}>
                <Input type="number" disabled={f.paper !== 'custom'} value={f.height} onChange={(e) => set({ height: Number(e.target.value) })} />
              </Field>
            </div>
            <Separator />
            <div className="grid grid-cols-4 gap-2">
              {(['page.marginTop', 'page.marginRight', 'page.marginBottom', 'page.marginLeft'] as const).map((key, i) => (
                <Field key={key} label={t(key)}>
                  <Input type="number" value={f.margin[i]} onChange={(e) => set({ margin: f.margin.map((v, k) => (k === i ? Number(e.target.value) : v)) as PageForm['margin'] })} />
                </Field>
              ))}
            </div>
            <Separator />
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('page.columns')}>
                <Choice label={t('page.columns')} value={String(f.columns)} onChange={(v) => set({ columns: Number(v) })} items={[1, 2, 3, 4].map((n) => ({ value: String(n), label: t('page.columnsN', { count: n }) }))} />
              </Field>
              <Field label={t('page.columnGap')}>
                <Input type="number" disabled={f.columns < 2} value={f.columnGap} onChange={(e) => set({ columnGap: Number(e.target.value) })} />
              </Field>
              <div className="flex items-end gap-2 pb-2">
                <Switch id="sep" disabled={f.columns < 2} checked={f.separator} onCheckedChange={(v) => set({ separator: v })} />
                <Label htmlFor="sep">{t('page.separator')}</Label>
              </div>
              <Field label={t('page.start')}>
                <Choice
                  label={t('page.start')}
                  value={f.start}
                  onChange={(start) => set({ start })}
                  items={[
                    { value: 'nextPage', label: t('section.nextPage') },
                    { value: 'continuous', label: t('section.continuous') },
                    { value: 'oddPage', label: t('section.oddPage') },
                    { value: 'evenPage', label: t('section.evenPage') },
                  ]}
                />
              </Field>
              <Field label={t('page.numberStart')}>
                <Input placeholder={t('page.numberContinue')} value={f.pageNumberStart} onChange={(e) => set({ pageNumberStart: e.target.value })} />
              </Field>
              <Field label={t('page.numberFormat')}>
                <Choice
                  label={t('page.numberFormat')}
                  value={f.pageNumberFormat}
                  onChange={(pageNumberFormat) => set({ pageNumberFormat })}
                  items={[
                    { value: 'decimal', label: '1, 2, 3' },
                    { value: 'roman', label: 'i, ii, iii' },
                    { value: 'hangul', label: '가, 나, 다' },
                  ]}
                />
              </Field>
            </div>
            {err && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}
          </div>
        )}
        <DialogFooter>
          {info && info.index < info.count - 1 && (
            <Button
              variant="destructive"
              className="mr-auto"
              onClick={() => {
                editor?.removeSectionBreak();
                onClose();
              }}
            >
              {t('page.removeSection')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={ok}>{t('dialog.apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 글 한 줄 묻기 ─────────────────────────────────────

export function PromptDialog(props: { open: boolean; title: string; description?: string; label: string; initial: string; placeholder?: string; okLabel?: string; removeLabel?: string; validate?: (v: string) => string | null; onSubmit: (v: string | null) => void; onClose: () => void }) {
  const [v, setV] = useState(props.initial);
  const [err, setErr] = useState<string | null>(null);
  const t = useT();
  useEffect(() => {
    if (props.open) {
      setV(props.initial);
      setErr(null);
    }
  }, [props.open, props.initial]);
  const submit = () => {
    const e = props.validate?.(v) ?? null;
    if (e) return setErr(e);
    props.onSubmit(v);
    props.onClose();
  };
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description && <DialogDescription>{props.description}</DialogDescription>}
        </DialogHeader>
        <Field label={props.label}>
          <Input
            autoFocus
            value={v}
            placeholder={props.placeholder}
            aria-invalid={!!err}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </Field>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
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
          <Button variant="outline" onClick={props.onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={submit}>{props.okLabel ?? t('dialog.ok')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 알림형 ────────────────────────────────────────────

export function InfoDialog({ open, title, description, children, onClose, wide }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={wide ? 'sm:max-w-lg' : 'sm:max-w-sm'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="text-sm">{children}</div>
        <DialogFooter>
          <Button onClick={onClose}>{t('dialog.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WordCountBody({ count, pages }: { count: WordCount | null; pages: number }) {
  const t = useT();
  const rows: Array<[string, number]> = count
    ? [
        [t('count.pages'), pages],
        [t('count.chars'), count.chars],
        [t('count.charsNoSpace'), count.charsNoSpace],
        [t('count.words'), count.words],
        [t('count.paragraphs'), count.paragraphs],
      ]
    : [];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium tabular-nums">{v.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 단축키 표: 키는 그대로, 설명은 번역 (Alt+클릭 줄만 키도 번역) */
const SHORTCUT_ROWS: Array<[string, AppMessageKey]> = [
  ['Ctrl+B / I / U', 'shortcut.format'],
  ['Ctrl+Z / Ctrl+Y', 'shortcut.undo'],
  ['Ctrl+F / Ctrl+H', 'shortcut.find'],
  ['Ctrl+Enter', 'shortcut.pageBreak'],
  ['Ctrl+Shift+Enter', 'shortcut.columnBreak'],
  ['Ctrl+Alt+Enter', 'shortcut.sectionBreak'],
  ['Ctrl+Shift+8 / 7', 'shortcut.lists'],
  ['Tab / Shift+Tab', 'shortcut.tab'],
  ['Alt+Shift+↑ / ↓', 'shortcut.move'],
  ['', 'shortcut.multiCursor'],
  ['Ctrl+Alt+M', 'shortcut.comment'],
  ['Ctrl+Alt+K / J', 'shortcut.highlight'],
  ['Ctrl+S', 'shortcut.save'],
  ['Ctrl+P', 'shortcut.print'],
];

export function ShortcutsBody() {
  const t = useT();
  return (
    <div className="grid gap-1.5">
      {SHORTCUT_ROWS.map(([keys, label]) => [keys || t('shortcut.multiCursorKeys'), t(label)] as const).map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 border-b py-1.5 last:border-0">
          <span>{v}</span>
          <span className="flex flex-wrap justify-end gap-1">
            {k.split(' / ').map((part) => (
              <Kbd key={part}>{part}</Kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
