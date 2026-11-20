'use client';
/** 상황별 도구 줄: 표 안·그림을 고름·머리말/꼬리말 편집·각주 편집일 때 나타난다 */
import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowRightToLine, Combine, Footprints, Image as ImageIcon, PaintBucket, PanelTop, Split, Table, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Act } from '@/lib/use-ui';
import type { Placement, Ui } from '@/lib/quire-app';

const keep = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };
const Sep = () => <Separator orientation="vertical" className="mx-1 h-5!" />;

function Bar({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-4 py-1.5">
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

const PLACEMENTS: Array<[Placement, string]> = [
  ['inline', '글자처럼'],
  ['square', '어울림'],
  ['topBottom', '위아래'],
  ['front', '글 앞'],
  ['behind', '글 뒤'],
];

export function ContextBar({ ui, act, onAlt }: { ui: Ui | null; act: Act; onAlt: () => void }) {
  if (!ui) return null;
  const icon = 'size-4 text-muted-foreground';
  if (ui.headerFooter) {
    const h = ui.headerFooter;
    return (
      <Bar icon={<PanelTop className={icon} />} title={h.part === 'header' ? '머리말' : '꼬리말'}>
        <Flag pressed={h.titlePage} onClick={() => act((e) => e.setHeaderFooterOption('titlePage', !h.titlePage))}>
          첫 쪽 다르게
        </Flag>
        <Flag pressed={h.oddEven} onClick={() => act((e) => e.setHeaderFooterOption('oddEven', !h.oddEven))}>
          홀짝 쪽 다르게
        </Flag>
        <Flag pressed={h.linked} disabled={h.first} onClick={() => act((e) => e.setHeaderFooterLinked(!h.linked))}>
          앞 구역과 연결
        </Flag>
        <Sep />
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.insertField('page'))}>
          쪽 번호
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.insertField('pages'))}>
          전체 쪽 수
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.editHeaderFooter(h.part === 'header' ? 'footer' : 'header'))}>
          {h.part === 'header' ? '꼬리말로' : '머리말로'}
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" {...keep} onClick={() => act((e) => e.closeHeaderFooter())}>
          <X /> 닫기
        </Button>
      </Bar>
    );
  }
  if (ui.note) {
    return (
      <Bar icon={<Footprints className={icon} />} title={`각주 ${ui.note.number}`}>
        <span className="text-xs text-muted-foreground">본문으로 돌아가려면 Esc</span>
        <Button variant="ghost" size="sm" className="ml-auto" {...keep} onClick={() => act((e) => e.closeNote())}>
          <X /> 닫기
        </Button>
      </Bar>
    );
  }
  if (ui.object) {
    const o = ui.object;
    return (
      <Bar icon={<ImageIcon className={icon} />} title="그림">
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[o.placement]} onValueChange={(v) => v[0] && act((e) => e.setPlacement(v[0] as Placement))}>
          {PLACEMENTS.map(([k, label]) => (
            <ToggleGroupItem key={k} value={k} {...keep}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Sep />
        <Button variant="ghost" size="sm" {...keep} onClick={onAlt}>
          대체 텍스트{o.alt ? `: ${o.alt.slice(0, 12)}` : ''}
        </Button>
        <span className="text-xs text-muted-foreground">모서리 손잡이로 크기를, 떠 있는 그림은 끌어서 자리를 바꾼다</span>
      </Bar>
    );
  }
  if (ui.table.inTable) {
    const t = ui.table;
    return (
      <Bar icon={<Table className={icon} />} title="표">
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableAddRow(true))}>
          <ArrowDownToLine /> 행
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableAddCol(true))}>
          <ArrowRightToLine /> 열
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableDelete('row'))}>
          <Trash2 /> 행
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableDelete('col'))}>
          <Trash2 /> 열
        </Button>
        <Sep />
        <Button variant="ghost" size="sm" disabled={!t.range} {...keep} onClick={() => act((e) => e.tableMerge())}>
          <Combine /> 합치기
        </Button>
        <Button variant="ghost" size="sm" disabled={!t.merged} {...keep} onClick={() => act((e) => e.tableUnmerge())}>
          <Split /> 나누기
        </Button>
        <Button variant="ghost" size="sm" {...keep} onClick={() => act((e) => e.tableCellFill('#eef2f6'))}>
          <PaintBucket /> 배경
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="셀 배경 지우기" {...keep} onClick={() => act((e) => e.tableCellFill(undefined))}>
          <X />
        </Button>
        <Sep />
        <Flag pressed={t.header} onClick={() => act((e) => e.tableSetRowFlag('header', !t.header))}>
          제목 행 반복
        </Flag>
        <Flag pressed={t.cantSplit} onClick={() => act((e) => e.tableSetRowFlag('cantSplit', !t.cantSplit))}>
          행 나누지 않기
        </Flag>
        <Button variant="ghost" size="sm" className="ml-auto text-destructive" {...keep} onClick={() => act((e) => e.deleteTable())}>
          <Trash2 /> 표 지우기
        </Button>
      </Bar>
    );
  }
  return null;
}
