/** 상황별 도구 줄: 표 안·그림을 고름·머리말/꼬리말 편집·각주 편집일 때 도구 막대 아래에 나타난다. 편집 영역 위에 떠 있어 자리를 차지하지 않는다 (나타나고 사라질 때 문서가 밀리면 두 번 누르기의 두 번째가 다른 곳에 떨어진다) */
import { ArrowDownToLine, ArrowRightToLine, Combine, Footprints, Image as ImageIcon, PaintBucket, PanelTop, Split, Table, Trash2, X } from 'lucide-react';
import type { Editor } from '@quire/editor';
import type { Placement, Ui } from '../lib/quire-app';
import { Button, Divider, ToolButton } from './ui';

type Act = (f: (e: Editor) => unknown) => void;

const PLACEMENTS: Array<[Placement, string]> = [
  ['inline', '글자처럼'],
  ['square', '어울림 (사각)'],
  ['topBottom', '위아래'],
  ['front', '글 앞'],
  ['behind', '글 뒤'],
];

function Bar({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-1 shadow-sm backdrop-blur-sm border-b border-slate-200 bg-sky-50/95 px-4 py-1 text-[13px]" onContextMenu={(e) => e.stopPropagation()}>
      <span className="mr-2 flex items-center gap-1.5 font-medium text-sky-900">
        {icon}
        {title}
      </span>
      {children}
    </div>
  );
}

const Chip = ({ on, children, onClick, disabled }: { on?: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }) => (
  <button
    type="button"
    disabled={disabled}
    aria-pressed={on}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className={'h-7 rounded-full border px-2.5 text-xs transition-colors disabled:opacity-40 ' + (on ? 'border-sky-500 bg-sky-100 text-sky-900' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}
  >
    {children}
  </button>
);

export function ContextBar({ ui, act, onAlt }: { ui: Ui | null; act: Act; onAlt: () => void }) {
  if (!ui) return null;
  if (ui.headerFooter) {
    const h = ui.headerFooter;
    return (
      <Bar icon={<PanelTop className="size-4" />} title={h.part === 'header' ? '머리말 고치는 중' : '꼬리말 고치는 중'}>
        <Chip on={h.titlePage} onClick={() => act((e) => e.setHeaderFooterOption('titlePage', !h.titlePage))}>
          첫 쪽 다르게
        </Chip>
        <Chip on={h.oddEven} onClick={() => act((e) => e.setHeaderFooterOption('oddEven', !h.oddEven))}>
          홀짝 쪽 다르게
        </Chip>
        <Chip on={h.linked} disabled={h.first} onClick={() => act((e) => e.setHeaderFooterLinked(!h.linked))}>
          앞 구역과 연결
        </Chip>
        <Divider />
        <Chip onClick={() => act((e) => e.insertField('page'))}>쪽 번호 넣기</Chip>
        <Chip onClick={() => act((e) => e.insertField('pages'))}>전체 쪽 수 넣기</Chip>
        <Chip onClick={() => act((e) => e.editHeaderFooter(h.part === 'header' ? 'footer' : 'header'))}>{h.part === 'header' ? '꼬리말로' : '머리말로'}</Chip>
        <div className="ml-auto" />
        <Button variant="ghost" onClick={() => act((e) => e.closeHeaderFooter())}>
          <X className="size-4" /> 닫기 (Esc)
        </Button>
      </Bar>
    );
  }
  if (ui.note) {
    return (
      <Bar icon={<Footprints className="size-4" />} title={`각주 ${ui.note.number} 고치는 중`}>
        <span className="text-xs text-slate-500">본문으로 돌아가려면 Esc 또는 닫기</span>
        <div className="ml-auto" />
        <Button variant="ghost" onClick={() => act((e) => e.closeNote())}>
          <X className="size-4" /> 닫기
        </Button>
      </Bar>
    );
  }
  if (ui.object) {
    const o = ui.object;
    return (
      <Bar icon={<ImageIcon className="size-4" />} title="그림">
        {PLACEMENTS.map(([k, label]) => (
          <Chip key={k} on={o.placement === k} onClick={() => act((e) => e.setPlacement(k))}>
            {label}
          </Chip>
        ))}
        <Divider />
        <Chip onClick={onAlt}>대체 텍스트{o.alt ? `: ${o.alt.slice(0, 12)}` : ' 넣기'}</Chip>
        <span className="ml-2 text-xs text-slate-500">모서리 손잡이로 크기를 바꾸고, 떠 있는 그림은 끌어서 옮긴다</span>
      </Bar>
    );
  }
  if (ui.table.inTable) {
    const t = ui.table;
    return (
      <Bar icon={<Table className="size-4" />} title="표">
        <ToolButton label="아래에 행 넣기" onClick={() => act((e) => e.tableAddRow(true))}>
          <ArrowDownToLine className="size-4" /> 행
        </ToolButton>
        <ToolButton label="오른쪽에 열 넣기" onClick={() => act((e) => e.tableAddCol(true))}>
          <ArrowRightToLine className="size-4" /> 열
        </ToolButton>
        <ToolButton label="행 지우기" onClick={() => act((e) => e.tableDelete('row'))}>
          <Trash2 className="size-4" /> 행
        </ToolButton>
        <ToolButton label="열 지우기" onClick={() => act((e) => e.tableDelete('col'))}>
          <Trash2 className="size-4" /> 열
        </ToolButton>
        <Divider />
        <ToolButton label="셀 합치기 (셀을 여러 개 고른 뒤)" disabled={!t.range} onClick={() => act((e) => e.tableMerge())}>
          <Combine className="size-4" /> 합치기
        </ToolButton>
        <ToolButton label="셀 나누기" disabled={!t.merged} onClick={() => act((e) => e.tableUnmerge())}>
          <Split className="size-4" /> 나누기
        </ToolButton>
        <ToolButton label="셀 배경 칠하기 (연회색)" onClick={() => act((e) => e.tableCellFill('#eef2f6'))}>
          <PaintBucket className="size-4" />
        </ToolButton>
        <ToolButton label="셀 배경 지우기" onClick={() => act((e) => e.tableCellFill(undefined))}>
          <X className="size-3.5" />
        </ToolButton>
        <Divider />
        <Chip on={t.header} onClick={() => act((e) => e.tableSetRowFlag('header', !t.header))}>
          제목 행 반복
        </Chip>
        <Chip on={t.cantSplit} onClick={() => act((e) => e.tableSetRowFlag('cantSplit', !t.cantSplit))}>
          행 나누지 않기
        </Chip>
        <div className="ml-auto" />
        <Button variant="ghost" onClick={() => act((e) => e.deleteTable())}>
          <Trash2 className="size-4" /> 표 지우기
        </Button>
      </Bar>
    );
  }
  return null;
}
