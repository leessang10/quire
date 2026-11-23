'use client';
/** 상황별 도구 줄: 표 안·그림을 고름·머리말/꼬리말 편집·각주 편집일 때 나타난다. 편집 영역 위에 떠 있어 자리를 차지하지 않는다 (나타나고 사라질 때 문서가 밀리면 두 번 누르기의 두 번째가 다른 곳에 떨어진다) */
import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowRightToLine, Combine, Footprints, Image as ImageIcon, PaintBucket, PanelTop, Split, Table, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Act } from '@/lib/use-ui';
import type { Placement, Ui } from '@/lib/quire-app';
import { useT } from '@/lib/i18n';

const keep = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };
const Sep = () => <Separator orientation="vertical" className="mx-1 h-5!" />;

function Bar({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-1 shadow-sm backdrop-blur-sm border-b bg-background/95 px-4 py-1.5" onContextMenu={(e) => e.stopPropagation()}>
      <span className="mr-2 flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </span>
      {children}
    </div>
  );
}

function Flag({ pressed, onClick, children, disabled }: { pressed: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Toggle variant="outline" size="sm" pressed={pressed} disabled={disabled} onPressedChange={() => onClick()} {...keep}>
      {children}
    </Toggle>
  );
}

const PLACEMENTS: Placement[] = ['inline', 'square', 'topBottom', 'front', 'behind'];

export function ContextBar({ ui, act, onAlt }: { ui: Ui | null; act: Act; onAlt: () => void }) {
  const t = useT();
  if (!ui) return null;
  const icon = 'size-4 text-muted-foreground';
  if (ui.headerFooter) {
    const h = ui.headerFooter;
    return (
      <Bar icon={<PanelTop className={icon} />} title={h.part === 'header' ? t('ctx.header') : t('ctx.footer')}>
        <Flag pressed={h.titlePage} onClick={() => act((e) => e.setHeaderFooterOption('titlePage', !h.titlePage))}>
          {t('ctx.titlePage')}
        </Flag>
        <Flag pressed={h.oddEven} onClick={() => act((e) => e.setHeaderFooterOption('oddEven', !h.oddEven))}>
          {t('ctx.oddEven')}
        </Flag>
        <Flag pressed={h.linked} disabled={h.first} onClick={() => act((e) => e.setHeaderFooterLinked(!h.linked))}>
          {t('ctx.linked')}
        </Flag>
        <Sep />
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.insertField('page'))}>
          {t('insert.pageNumber')}
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.insertField('pages'))}>
          {t('insert.fieldPages')}
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.editHeaderFooter(h.part === 'header' ? 'footer' : 'header'))}>
          {h.part === 'header' ? t('ctx.toFooter') : t('ctx.toHeader')}
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" {...keep} onClick={() => act((e) => e.closeHeaderFooter())}>
          <X /> {t('ctx.close')}
        </Button>
      </Bar>
    );
  }
  if (ui.note) {
    return (
      <Bar icon={<Footprints className={icon} />} title={t('ctx.footnote', { number: ui.note.number })}>
        <span className="text-xs text-muted-foreground">{t('ctx.footnoteHint')}</span>
        <Button variant="ghost" size="sm" className="ml-auto" {...keep} onClick={() => act((e) => e.closeNote())}>
          <X /> {t('ctx.close')}
        </Button>
      </Bar>
    );
  }
  if (ui.object) {
    const o = ui.object;
    return (
      <Bar icon={<ImageIcon className={icon} />} title={t('ctx.image')}>
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[o.placement]} onValueChange={(v) => v[0] && act((e) => e.setPlacement(v[0] as Placement))}>
          {PLACEMENTS.map((k) => (
            <ToggleGroupItem key={k} value={k} {...keep}>
              {t(`placement.${k}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Sep />
        <Button variant="ghost" size="sm" {...keep} onClick={onAlt}>
          {o.alt ? t('ctx.altValue', { alt: o.alt.slice(0, 12) }) : t('ctx.alt')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('ctx.imageHint')}</span>
      </Bar>
    );
  }
  if (ui.table.inTable) {
    const tb = ui.table;
    return (
      <Bar icon={<Table className={icon} />} title={t('ctx.table')}>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableAddRow(true))}>
          <ArrowDownToLine /> {t('ctx.row')}
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableAddCol(true))}>
          <ArrowRightToLine /> {t('ctx.col')}
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableDelete('row'))}>
          <Trash2 /> {t('ctx.row')}
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableDelete('col'))}>
          <Trash2 /> {t('ctx.col')}
        </Button>
        <Sep />
        <Button variant="ghost" size="sm" disabled={!tb.range} {...keep} onClick={() => act((e) => e.tableMerge())}>
          <Combine /> {t('ctx.merge')}
        </Button>
        <Button variant="ghost" size="sm" disabled={!tb.merged} {...keep} onClick={() => act((e) => e.tableUnmerge())}>
          <Split /> {t('ctx.unmerge')}
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableCellFill('#eef2f6'))}>
          <PaintBucket /> {t('ctx.fill')}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t('ctx.clearFill')} {...keep} onClick={() => act((e) => e.tableCellFill(undefined))}>
          <X />
        </Button>
        <Sep />
        <Flag pressed={tb.header} onClick={() => act((e) => e.tableSetRowFlag('header', !tb.header))}>
          {t('ctx.headerRow')}
        </Flag>
        <Flag pressed={tb.cantSplit} onClick={() => act((e) => e.tableSetRowFlag('cantSplit', !tb.cantSplit))}>
          {t('ctx.cantSplit')}
        </Flag>
        <Button variant="ghost" size="sm" className="ml-auto text-destructive" {...keep} onClick={() => act((e) => e.deleteTable())}>
          <Trash2 /> {t('table.delete')}
        </Button>
      </Bar>
    );
  }
  return null;
}
