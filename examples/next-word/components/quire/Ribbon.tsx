'use client';
/**
 * 리본 (Word식): 탭(홈·삽입·레이아웃·검토·보기) 아래 그룹마다 큰 단추·작은 단추, 그룹 이름은 아래에.
 * 화면 조각은 shadcn (Tabs, Button, Toggle, Select, Popover, DropdownMenu, Tooltip, Separator)
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Columns2,
  Eraser,
  FileText,
  Footprints,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Languages,
  Link2,
  List,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Replace,
  ScrollText,
  Search,
  SeparatorHorizontal,
  SpellCheck,
  Strikethrough,
  Subscript,
  Superscript,
  Sun,
  Table,
  TextCursorInput,
  Underline,
  BookOpenCheck,
  CheckCheck,
  XCircle,
  PencilLine,
  Hash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import type { Act } from '@/lib/use-ui';
import { COLORS, FONTS, HIGHLIGHTS, LINE_SPACINGS, PAPERS, STYLES, applyPageForm, pageFormOf, paperSize, type Ui } from '@/lib/quire-app';
import type { Editor } from '@quire/editor';

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

/** 작은 토글 (아이콘) */
function T(props: { label: string; shortcut?: string; pressed?: boolean | null; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tip label={props.label} shortcut={props.shortcut}>
      <Toggle size="sm" aria-label={props.label} pressed={!!props.pressed} disabled={props.disabled} onPressedChange={() => props.onClick()} {...keep} className="h-7 min-w-7 px-1.5">
        {props.children}
      </Toggle>
    </Tip>
  );
}

/** 큰 단추: 아이콘 위, 이름 아래 */
function Big(props: { label: string; icon: ReactNode; onClick?: () => void; pressed?: boolean; disabled?: boolean; render?: ReactElement }) {
  const cls = cn('flex h-[62px] w-auto min-w-14 flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!', props.pressed && 'bg-primary/10 text-primary hover:bg-primary/15');
  return (
    <Button variant="ghost" className={cls} aria-pressed={props.pressed} disabled={props.disabled} onClick={props.onClick} {...keep}>
      {props.icon}
      <span className="leading-none">{props.label}</span>
    </Button>
  );
}

/** 작은 단추: 아이콘 + 이름 (세로로 쌓는다) */
function Small(props: { label: string; icon: ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <Button variant="ghost" size="sm" className={cn('h-6 justify-start gap-1.5 px-1.5 text-xs font-normal', props.pressed && 'bg-primary/10 text-primary')} aria-pressed={props.pressed} disabled={props.disabled} onClick={props.onClick} {...keep}>
      {props.icon}
      {props.label}
    </Button>
  );
}

/** 그룹: 내용 위, 이름 아래, 오른쪽에 구분선 */
function Group({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex shrink-0 flex-col border-r px-2 last:border-r-0">
      <div className={cn('flex min-h-[62px] items-center gap-0.5', className)}>{children}</div>
      <div className="pt-0.5 text-center text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

const Col = ({ children }: { children: ReactNode }) => <div className="flex flex-col gap-0.5">{children}</div>;
const Row = ({ children }: { children: ReactNode }) => <div className="flex items-center gap-0.5">{children}</div>;

export interface RibbonActions {
  link: () => void;
  image: () => void;
  comment: () => void;
  find: (replace: boolean) => void;
  pageSetup: () => void;
  wordCount: () => void;
  toggleSpell: () => void;
  togglePanel: (p: 'outline' | 'review') => void;
}

export function Ribbon({ ui, act, a, editor, panels, file }: { ui: Ui | null; act: Act; a: RibbonActions; editor: Editor | null; panels: { outline: boolean; review: boolean }; file: ReactNode }) {
  const [tab, setTab] = useState<string>('home');
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="gap-0 border-b bg-background">
      <div className="flex items-center gap-1 px-2 pt-1">
        {file}
        <TabsList variant="line" className="h-8">
          {(
            [
              ['home', '홈'],
              ['insert', '삽입'],
              ['layout', '레이아웃'],
              ['review', '검토'],
              ['view', '보기'],
            ] as const
          ).map(([v, label]) => (
            <TabsTrigger key={v} value={v} className="px-3 data-active:text-primary" {...keep}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="mx-2 mb-1.5 mt-1 overflow-x-auto rounded-lg border bg-muted/30 py-1">
        <TabsContent value="home" className="flex">
          <HomeTab ui={ui} act={act} a={a} />
        </TabsContent>
        <TabsContent value="insert" className="flex">
          <Group label="표">
            <TablePopover onPick={(r, c) => act((e) => e.insertTable(r, c))} />
          </Group>
          <Group label="그림">
            <Big label="그림" icon={<ImagePlus />} onClick={a.image} />
          </Group>
          <Group label="링크">
            <Big label="링크" icon={<Link2 />} onClick={a.link} pressed={!!ui?.marks.link} />
            <Big label="댓글" icon={<MessageSquarePlus />} onClick={a.comment} />
          </Group>
          <Group label="각주">
            <Big label="각주 넣기" icon={<Footprints />} onClick={() => act((e) => e.insertFootnote())} />
          </Group>
          <Group label="머리글/바닥글">
            <Col>
              <Small label="머리말" icon={<PanelTop className="size-3.5" />} onClick={() => act((e) => e.editHeaderFooter('header'))} />
              <Small label="꼬리말" icon={<PanelBottom className="size-3.5" />} onClick={() => act((e) => e.editHeaderFooter('footer'))} />
              <Small label="쪽 번호" icon={<Hash className="size-3.5" />} onClick={() => act((e) => e.insertField('page'))} />
            </Col>
          </Group>
          <Group label="나누기">
            <Col>
              <Small label="쪽 나누기" icon={<SeparatorHorizontal className="size-3.5" />} onClick={() => act((e) => e.insertPageBreak())} />
              <Small label="단 나누기" icon={<Columns2 className="size-3.5" />} onClick={() => act((e) => e.insertColumnBreak())} />
              <Small label="구역 나누기" icon={<ScrollText className="size-3.5" />} onClick={() => act((e) => e.insertSectionBreak('nextPage'))} />
            </Col>
          </Group>
        </TabsContent>
        <TabsContent value="layout" className="flex">
          <LayoutTab ui={ui} act={act} a={a} editor={editor} />
        </TabsContent>
        <TabsContent value="review" className="flex">
          <Group label="언어 교정">
            <Big label="맞춤법" icon={<SpellCheck />} pressed={!!ui?.spell} onClick={a.toggleSpell} />
            <Big label="글자 수" icon={<BookOpenCheck />} onClick={a.wordCount} />
          </Group>
          <Group label="메모">
            <Big label="새 메모" icon={<MessageSquarePlus />} onClick={a.comment} />
            <Big label="메모 창" icon={<PanelRight />} pressed={panels.review} onClick={() => a.togglePanel('review')} />
          </Group>
          <Group label="변경 내용 추적">
            <Big label="변경 내용 추적" icon={<PencilLine />} pressed={!!ui?.suggesting} onClick={() => act((e) => e.setSuggesting(!ui?.suggesting))} />
            <Col>
              <Small label="제안 표시" icon={<span className="size-3.5" />} pressed={ui?.viewMode === 'suggestions'} onClick={() => act((e) => e.setViewMode('suggestions'))} />
              <Small label="최종본" icon={<span className="size-3.5" />} pressed={ui?.viewMode === 'final'} onClick={() => act((e) => e.setViewMode('final'))} />
              <Small label="원본" icon={<span className="size-3.5" />} pressed={ui?.viewMode === 'original'} onClick={() => act((e) => e.setViewMode('original'))} />
            </Col>
          </Group>
          <Group label="변경 내용">
            <Big label="모두 적용" icon={<CheckCheck />} disabled={!ui?.suggestions} onClick={() => act((e) => e.acceptAll())} />
            <Big label="모두 취소" icon={<XCircle />} disabled={!ui?.suggestions} onClick={() => act((e) => e.rejectAll())} />
          </Group>
        </TabsContent>
        <TabsContent value="view" className="flex">
          <Group label="보기">
            <Big label="인쇄 모양" icon={<FileText />} pressed={ui?.appearance.pageView !== 'continuous'} onClick={() => act((e) => e.setPageView('print'))} />
            <Big label="연속 보기" icon={<ScrollText />} pressed={ui?.appearance.pageView === 'continuous'} onClick={() => act((e) => e.setPageView('continuous'))} />
          </Group>
          <Group label="표시">
            <Big label="탐색 창" icon={<PanelLeft />} pressed={panels.outline} onClick={() => a.togglePanel('outline')} />
            <Big label="메모 창" icon={<PanelRight />} pressed={panels.review} onClick={() => a.togglePanel('review')} />
          </Group>
          <Group label="화면 색">
            <Big label="밝게" icon={<Sun />} pressed={ui?.appearance.colorScheme !== 'dark'} onClick={() => act((e) => e.setColorScheme('light'))} />
            <Big label="어둡게" icon={<Moon />} pressed={ui?.appearance.colorScheme === 'dark'} onClick={() => act((e) => e.setColorScheme('dark'))} />
          </Group>
        </TabsContent>
      </div>
    </Tabs>
  );
}

function HomeTab({ ui, act, a }: { ui: Ui | null; act: Act; a: RibbonActions }) {
  const m = ui?.marks;
  const p = ui?.para;
  const size = m?.size ?? null;
  const setSize = (v: number) => act((e) => e.setMark('size', Math.round(Math.max(1, Math.min(400, v)) * 1000)));
  return (
    <>
      <Group label="글꼴">
        <Col>
          <Row>
            <Select items={FONTS.map((f) => ({ value: f, label: f }))} value={m?.font ?? null} onValueChange={(v) => v && act((e) => e.setMark('font', v === 'Pretendard' ? undefined : String(v)))}>
              <SelectTrigger size="sm" className="h-7 w-36 bg-background" aria-label="글꼴">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              aria-label="글자 크기"
              className="h-7 w-11 rounded-md border bg-background text-center text-sm tabular-nums"
              defaultValue={size ?? ''}
              key={String(size)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSize(Number((e.target as HTMLInputElement).value));
              }}
            />
            <T label="글자 크게" onClick={() => setSize((size ?? 12) + 1)}>
              <Plus />
            </T>
            <T label="글자 작게" onClick={() => setSize((size ?? 12) - 1)}>
              <Minus />
            </T>
            <T label="서식 지우기" onClick={() => act((e) => e.clearMarks())}>
              <Eraser />
            </T>
          </Row>
          <Row>
            <T label="굵게" shortcut="Ctrl+B" pressed={m?.bold} onClick={() => act((e) => e.toggleMark('bold'))}>
              <Bold />
            </T>
            <T label="기울임꼴" shortcut="Ctrl+I" pressed={m?.italic} onClick={() => act((e) => e.toggleMark('italic'))}>
              <Italic />
            </T>
            <T label="밑줄" shortcut="Ctrl+U" pressed={m?.underline} onClick={() => act((e) => e.toggleMark('underline'))}>
              <Underline />
            </T>
            <T label="취소선" pressed={m?.strike} onClick={() => act((e) => e.toggleMark('strike'))}>
              <Strikethrough />
            </T>
            <T label="아래 첨자" pressed={m?.script === 'sub'} onClick={() => act((e) => e.toggleScript('sub'))}>
              <Subscript />
            </T>
            <T label="위 첨자" pressed={m?.script === 'sup'} onClick={() => act((e) => e.toggleScript('sup'))}>
              <Superscript />
            </T>
            <ColorPopover label="텍스트 강조 색" icon={<Highlighter />} value={m?.highlight ?? null} colors={HIGHLIGHTS} none="색 없음" onPick={(c) => act((e) => e.setMark('highlight', c ?? undefined))} />
            <ColorPopover label="글꼴 색" icon={<Baseline />} value={m?.color ?? null} colors={COLORS} none="자동" onPick={(c) => act((e) => e.setMark('color', c ?? undefined))} />
          </Row>
        </Col>
      </Group>
      <Group label="단락">
        <Col>
          <Row>
            <T label="글머리 기호" pressed={p?.list === 'bullet'} onClick={() => act((e) => e.toggleList('bullet'))}>
              <List />
            </T>
            <T label="번호 매기기" pressed={p?.list === 'number'} onClick={() => act((e) => e.toggleList('number'))}>
              <ListOrdered />
            </T>
            <T label="내어쓰기" onClick={() => act((e) => e.indent(-1))}>
              <IndentDecrease />
            </T>
            <T label="들여쓰기" onClick={() => act((e) => e.indent(1))}>
              <IndentIncrease />
            </T>
          </Row>
          <Row>
            {(
              [
                ['left', '왼쪽 맞춤', AlignLeft],
                ['center', '가운데 맞춤', AlignCenter],
                ['right', '오른쪽 맞춤', AlignRight],
                ['justify', '양쪽 맞춤', AlignJustify],
              ] as const
            ).map(([al, label, Icon]) => (
              <T key={al} label={label} pressed={p?.align === al} onClick={() => act((e) => e.setParagraphAttr('align', al === 'left' ? undefined : al))}>
                <Icon />
              </T>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-7 gap-0.5 px-1.5 text-xs" aria-label="줄 간격" {...keep} />}>
                <TextCursorInput className="size-4" />
                <ChevronDown className="size-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-36" finalFocus={false}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>줄 간격</DropdownMenuLabel>
                  {LINE_SPACINGS.map((v) => (
                    <DropdownMenuItem key={v} onClick={() => act((e) => e.setParagraphAttr('line', v === 1 ? undefined : { rule: 'multiple', value: v }))}>
                      {v === p?.line ? '✓ ' : ''}
                      {v}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Row>
        </Col>
      </Group>
      <Group label="스타일" className="gap-1">
        {STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            {...keep}
            onClick={() => act((e) => e.setParagraphStyle(s.id))}
            className={cn(
              'flex h-[58px] w-[74px] flex-col items-start justify-center rounded-md border bg-background px-2 text-left hover:border-primary/50',
              p?.style === s.id && 'border-primary ring-2 ring-primary/20',
            )}
          >
            <span className={cn('truncate text-sm leading-tight', s.id === 'h1' && 'text-base font-bold', s.id === 'h2' && 'font-bold', s.id === 'h3' && 'font-semibold', s.id === 'quote' && 'italic text-muted-foreground')}>가나다AaBb</span>
            <span className="text-[11px] text-muted-foreground">{s.label}</span>
          </button>
        ))}
      </Group>
      <Group label="편집">
        <Col>
          <Small label="찾기" icon={<Search className="size-3.5" />} onClick={() => a.find(false)} />
          <Small label="바꾸기" icon={<Replace className="size-3.5" />} onClick={() => a.find(true)} />
          <Small label="맞춤법" icon={<Languages className="size-3.5" />} pressed={!!ui?.spell} onClick={a.toggleSpell} />
        </Col>
      </Group>
    </>
  );
}

const MARGINS: Array<[string, number]> = [
  ['보통 (25.4mm)', 25.4],
  ['좁게 (12.7mm)', 12.7],
  ['넓게 (38.1mm)', 38.1],
];

function LayoutTab({ ui, act, a, editor }: { ui: Ui | null; act: Act; a: RibbonActions; editor: Editor | null }) {
  const form = editor ? pageFormOf(editor.sectionInfo().props) : null;
  const p = ui?.para;
  const apply = (patch: (f: NonNullable<typeof form>) => void) =>
    act((e) => {
      const f = pageFormOf(e.sectionInfo().props);
      patch(f);
      applyPageForm(e, f);
    });
  return (
    <>
      <Group label="페이지 설정">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="flex h-[62px] flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!" {...keep} />}>
            <RectangleVertical />
            여백
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48" finalFocus={false}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>여백</DropdownMenuLabel>
              {MARGINS.map(([label, mm]) => (
                <DropdownMenuItem key={label} onClick={() => apply((f) => void (f.margin = [mm, mm, mm, mm]))}>
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={a.pageSetup}>사용자 지정 여백…</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="flex h-[62px] flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!" {...keep} />}>
            {form?.orientation === 'landscape' ? <RectangleHorizontal /> : <RectangleVertical />}
            용지 방향
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-36" finalFocus={false}>
            <DropdownMenuGroup>
              {(['portrait', 'landscape'] as const).map((o) => (
                <DropdownMenuItem
                  key={o}
                  onClick={() =>
                    apply((f) => {
                      f.orientation = o;
                      const s = paperSize(f.paper, o);
                      if (s) [f.width, f.height] = s;
                      else if ((f.width > f.height) !== (o === 'landscape')) [f.width, f.height] = [f.height, f.width];
                    })
                  }
                >
                  {form?.orientation === o ? '✓ ' : ''}
                  {o === 'portrait' ? '세로' : '가로'}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="flex h-[62px] flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!" {...keep} />}>
            <FileText />
            크기
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-36" finalFocus={false}>
            <DropdownMenuGroup>
              {PAPERS.map((pp) => (
                <DropdownMenuItem
                  key={pp}
                  onClick={() =>
                    apply((f) => {
                      f.paper = pp;
                      const s = paperSize(pp, f.orientation);
                      if (s) [f.width, f.height] = s;
                    })
                  }
                >
                  {form?.paper === pp ? '✓ ' : ''}
                  {pp}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="flex h-[62px] flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!" {...keep} />}>
            <Columns2 />단
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-32" finalFocus={false}>
            <DropdownMenuGroup>
              {[1, 2, 3].map((n) => (
                <DropdownMenuItem key={n} onClick={() => apply((f) => void (f.columns = n))}>
                  {form?.columns === n ? '✓ ' : ''}
                  {n}단
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Col>
          <Small label="나누기" icon={<SeparatorHorizontal className="size-3.5" />} onClick={() => act((e) => e.insertPageBreak())} />
          <Small label="페이지 설정…" icon={<PanelTop className="size-3.5" />} onClick={a.pageSetup} />
        </Col>
      </Group>
      <Group label="단락 (쪽 나눔)">
        <Col>
          <Small label="앞에서 쪽 나누기" icon={<span className="size-3.5" />} pressed={!!p?.pageBreakBefore} onClick={() => act((e) => e.toggleParagraphKeep('pageBreakBefore'))} />
          <Small label="다음 단락과 함께" icon={<span className="size-3.5" />} pressed={!!p?.keepWithNext} onClick={() => act((e) => e.toggleParagraphKeep('keepWithNext'))} />
          <Small label="단락 나누지 않기" icon={<span className="size-3.5" />} pressed={!!p?.keepTogether} onClick={() => act((e) => e.toggleParagraphKeep('keepTogether'))} />
        </Col>
      </Group>
      <Group label="한글 조판">
        <Col>
          <Small label="글자 단위 줄 바꿈" icon={<span className="size-3.5" />} pressed={p?.koreanBreak === 'char'} onClick={() => act((e) => e.setParagraphAttr('koreanBreak', p?.koreanBreak === 'char' ? undefined : 'char'))} />
          <Small label="문장부호 내어 쓰기" icon={<span className="size-3.5" />} pressed={!!p?.hangPunct} onClick={() => act((e) => e.setParagraphAttr('hangPunct', p?.hangPunct ? undefined : true))} />
          <Small label="줄 끝 공백 줄이기" icon={<span className="size-3.5" />} pressed={!!p?.squeeze} onClick={() => act((e) => e.setParagraphAttr('squeeze', p?.squeeze ? undefined : true))} />
        </Col>
      </Group>
    </>
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
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={props.label} className="size-7 flex-col gap-0" {...keep} />}>
          {props.icon}
          <span className="-mt-0.5 h-1 w-4 rounded-sm" style={{ background: props.value ?? 'transparent', outline: props.value ? undefined : '1px solid var(--border)' }} />
        </PopoverTrigger>
      </Tip>
      <PopoverContent className="w-52 gap-2 p-2" initialFocus={false} finalFocus={false}>
        <div className="grid grid-cols-8 gap-1">
          {props.colors.map((c) => (
            <button key={c} type="button" title={c} aria-label={c} {...keep} onClick={() => pick(c)} className={cn('size-5 rounded-sm border', props.value === c && 'ring-2 ring-ring ring-offset-1')} style={{ background: c }} />
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
      <PopoverTrigger render={<Button variant="ghost" className="flex h-[62px] flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!" {...keep} />}>
        <Table />표
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" initialFocus={false} finalFocus={false}>
        <div className="mb-1.5 text-xs text-muted-foreground">{hover[0] ? `${hover[1]} × ${hover[0]} 표` : '표 삽입'}</div>
        <div className="grid grid-cols-10 gap-0.5" onMouseLeave={() => setHover([0, 0])}>
          {Array.from({ length: 80 }, (_, i) => {
            const r = Math.floor(i / 10) + 1;
            const c = (i % 10) + 1;
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
                className={cn('size-4 border', on ? 'border-primary bg-primary/20' : 'bg-background')}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
