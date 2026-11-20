'use client';
/** 대화상자 (shadcn Dialog): 쪽 설정, 글 한 줄 묻기(링크·대체 텍스트), 글자 수, 단축키, 알림 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Editor, WordCount } from '@quire/editor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PAPERS, SHORTCUTS, applyPageForm, checkPageForm, pageFormOf, paperSize, type PageForm } from '@/lib/quire-app';

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
    const e = checkPageForm(f);
    if (e) return setErr(e);
    if (editor) applyPageForm(editor, f);
    onClose();
    setTimeout(() => editor?.focus(), 0);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>쪽 설정</DialogTitle>
          <DialogDescription>{info && info.count > 1 ? `구역 ${info.index + 1}/${info.count}에 적용합니다.` : '문서 전체(구역 하나)에 적용합니다.'}</DialogDescription>
        </DialogHeader>
        {f && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="용지">
                <Choice label="용지" value={f.paper} onChange={(paper) => set({ paper })} items={[...PAPERS.map((p) => ({ value: p, label: p })), { value: 'custom', label: '사용자 지정' }]} />
              </Field>
              <Field label="방향">
                <ToggleGroup variant="outline" spacing={0} className="w-full" value={[f.orientation]} onValueChange={(v) => v[0] && set({ orientation: v[0] as PageForm['orientation'] })}>
                  <ToggleGroupItem value="portrait" className="flex-1">
                    세로
                  </ToggleGroupItem>
                  <ToggleGroupItem value="landscape" className="flex-1">
                    가로
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field label="너비 (mm)">
                <Input type="number" disabled={f.paper !== 'custom'} value={f.width} onChange={(e) => set({ width: Number(e.target.value) })} />
              </Field>
              <Field label="높이 (mm)">
                <Input type="number" disabled={f.paper !== 'custom'} value={f.height} onChange={(e) => set({ height: Number(e.target.value) })} />
              </Field>
            </div>
            <Separator />
            <div className="grid grid-cols-4 gap-2">
              {(['위', '오른쪽', '아래', '왼쪽'] as const).map((label, i) => (
                <Field key={label} label={`${label} 여백`}>
                  <Input type="number" value={f.margin[i]} onChange={(e) => set({ margin: f.margin.map((v, k) => (k === i ? Number(e.target.value) : v)) as PageForm['margin'] })} />
                </Field>
              ))}
            </div>
            <Separator />
            <div className="grid grid-cols-3 gap-3">
              <Field label="단 수">
                <Choice label="단 수" value={String(f.columns)} onChange={(v) => set({ columns: Number(v) })} items={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}단` }))} />
              </Field>
              <Field label="단 사이 (mm)">
                <Input type="number" disabled={f.columns < 2} value={f.columnGap} onChange={(e) => set({ columnGap: Number(e.target.value) })} />
              </Field>
              <div className="flex items-end gap-2 pb-2">
                <Switch id="sep" disabled={f.columns < 2} checked={f.separator} onCheckedChange={(v) => set({ separator: v })} />
                <Label htmlFor="sep">구분선</Label>
              </div>
              <Field label="구역 시작">
                <Choice
                  label="구역 시작"
                  value={f.start}
                  onChange={(start) => set({ start })}
                  items={[
                    { value: 'nextPage', label: '다음 쪽' },
                    { value: 'continuous', label: '이어서' },
                    { value: 'oddPage', label: '홀수 쪽' },
                    { value: 'evenPage', label: '짝수 쪽' },
                  ]}
                />
              </Field>
              <Field label="쪽 번호 시작">
                <Input placeholder="이어서" value={f.pageNumberStart} onChange={(e) => set({ pageNumberStart: e.target.value })} />
              </Field>
              <Field label="쪽 번호 모양">
                <Choice
                  label="쪽 번호 모양"
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
              구역 나눔 지우기
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={ok}>적용</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 글 한 줄 묻기 ─────────────────────────────────────

export function PromptDialog(props: { open: boolean; title: string; description?: string; label: string; initial: string; placeholder?: string; okLabel?: string; removeLabel?: string; validate?: (v: string) => string | null; onSubmit: (v: string | null) => void; onClose: () => void }) {
  const [v, setV] = useState(props.initial);
  const [err, setErr] = useState<string | null>(null);
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
            취소
          </Button>
          <Button onClick={submit}>{props.okLabel ?? '확인'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 알림형 ────────────────────────────────────────────

export function InfoDialog({ open, title, description, children, onClose, wide }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={wide ? 'sm:max-w-lg' : 'sm:max-w-sm'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="text-sm">{children}</div>
        <DialogFooter>
          <Button onClick={onClose}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WordCountBody({ count, pages }: { count: WordCount | null; pages: number }) {
  const rows: Array<[string, number]> = count
    ? [
        ['쪽', pages],
        ['글자 (공백 포함)', count.chars],
        ['글자 (공백 제외)', count.charsNoSpace],
        ['어절', count.words],
        ['문단', count.paragraphs],
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

export function ShortcutsBody() {
  return (
    <div className="grid gap-1.5">
      {SHORTCUTS.map(([k, v]) => (
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
