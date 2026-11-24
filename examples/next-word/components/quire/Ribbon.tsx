'use client';
/**
 * 리본 (Word식): 탭(홈·삽입·레이아웃·검토·보기) 아래 그룹마다 큰 단추·작은 단추, 그룹 이름은 아래에.
 * 화면 조각은 shadcn (Tabs, Button, Toggle, Select, Popover, DropdownMenu, Tooltip, Separator)
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  ChevronUp,
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
  Pilcrow,
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
import type { Editor } from '@quiredoc/core';
import { LOCALES, useI18n, useT } from '@/lib/i18n';
import type { AppMessageKey } from '@/lib/messages';

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
  const { t, locale, setLocale } = useI18n();
  // 리본 접기 (Word의 "리본 축소", Ctrl+F1): 접으면 탭 이름만 남고, 탭을 누르면 다시 펼친다
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setCollapsed((c) => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(String(v));
        setCollapsed(false);
      }}
      className="gap-0 border-b bg-background"
    >
      <div className="flex items-center gap-1 px-2 pt-1">
        {file}
        <TabsList variant="line" className="h-8">
          {(
            [
              ['home', 'word.tab.home'],
              ['insert', 'word.tab.insert'],
              ['layout', 'word.tab.layout'],
              ['review', 'word.tab.review'],
              ['view', 'word.tab.view'],
            ] as const
          ).map(([v, label]) => (
            <TabsTrigger key={v} value={v} className="px-3 data-active:text-primary" {...keep}>
              {t(label)}
            </TabsTrigger>
          ))}
        </TabsList>
        <Tip label={collapsed ? t('word.ribbonPin') : t('word.ribbonCollapse')} shortcut="Ctrl+F1">
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={collapsed ? t('word.ribbonPin') : t('word.ribbonCollapse')} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} {...keep}>
            {collapsed ? <ChevronDown /> : <ChevronUp />}
          </Button>
        </Tip>
      </div>
      <div hidden={collapsed} className="mx-2 mb-1.5 mt-1 overflow-x-auto rounded-lg border bg-muted/30 py-1">
        <TabsContent value="home" className="flex">
          <HomeTab ui={ui} act={act} a={a} />
        </TabsContent>
        <TabsContent value="insert" className="flex">
          <Group label={t('word.g.tables')}>
            <TablePopover onPick={(r, c) => act((e) => e.insertTable(r, c))} />
          </Group>
          <Group label={t('word.g.illustrations')}>
            <Big label={t('word.pictures')} icon={<ImagePlus />} onClick={a.image} />
          </Group>
          <Group label={t('word.g.links')}>
            <Big label={t('word.link')} icon={<Link2 />} onClick={a.link} pressed={!!ui?.marks.link} />
            <Big label={t('word.comment')} icon={<MessageSquarePlus />} onClick={a.comment} />
          </Group>
          <Group label={t('word.g.footnotes')}>
            <Big label={t('word.footnote')} icon={<Footprints />} onClick={() => act((e) => e.insertFootnote())} />
          </Group>
          <Group label={t('word.g.headerFooter')}>
            <Col>
              <Small label={t('word.header')} icon={<PanelTop className="size-3.5" />} onClick={() => act((e) => e.editHeaderFooter('header'))} />
              <Small label={t('word.footer')} icon={<PanelBottom className="size-3.5" />} onClick={() => act((e) => e.editHeaderFooter('footer'))} />
              <Small label={t('word.pageNumber')} icon={<Hash className="size-3.5" />} onClick={() => act((e) => e.insertField('page'))} />
            </Col>
          </Group>
          <Group label={t('word.breaks')}>
            <Col>
              <Small label={t('word.pageBreak')} icon={<SeparatorHorizontal className="size-3.5" />} onClick={() => act((e) => e.insertPageBreak())} />
              <Small label={t('word.columnBreak')} icon={<Columns2 className="size-3.5" />} onClick={() => act((e) => e.insertColumnBreak())} />
              <Small label={t('word.sectionBreak')} icon={<ScrollText className="size-3.5" />} onClick={() => act((e) => e.insertSectionBreak('nextPage'))} />
            </Col>
          </Group>
        </TabsContent>
        <TabsContent value="layout" className="flex">
          <LayoutTab ui={ui} act={act} a={a} editor={editor} />
        </TabsContent>
        <TabsContent value="review" className="flex">
          <Group label={t('word.g.proofing')}>
            <Big label={t('word.spelling')} icon={<SpellCheck />} pressed={!!ui?.spell} onClick={a.toggleSpell} />
            <Big label={t('word.countButton')} icon={<BookOpenCheck />} onClick={a.wordCount} />
          </Group>
          <Group label={t('word.g.comments')}>
            <Big label={t('word.newComment')} icon={<MessageSquarePlus />} onClick={a.comment} />
            <Big label={t('word.commentPane')} icon={<PanelRight />} pressed={panels.review} onClick={() => a.togglePanel('review')} />
          </Group>
          <Group label={t('word.g.tracking')}>
            <Big label={t('word.trackChanges')} icon={<PencilLine />} pressed={!!ui?.suggesting} onClick={() => act((e) => e.setSuggesting(!ui?.suggesting))} />
            <Col>
              <Small label={t('word.allMarkup')} icon={<span className="size-3.5" />} pressed={ui?.viewMode === 'suggestions'} onClick={() => act((e) => e.setViewMode('suggestions'))} />
              <Small label={t('word.noMarkup')} icon={<span className="size-3.5" />} pressed={ui?.viewMode === 'final'} onClick={() => act((e) => e.setViewMode('final'))} />
              <Small label={t('word.original')} icon={<span className="size-3.5" />} pressed={ui?.viewMode === 'original'} onClick={() => act((e) => e.setViewMode('original'))} />
            </Col>
          </Group>
          <Group label={t('word.g.changes')}>
            <Big label={t('word.acceptAll')} icon={<CheckCheck />} disabled={!ui?.suggestions} onClick={() => act((e) => e.acceptAll())} />
            <Big label={t('word.rejectAll')} icon={<XCircle />} disabled={!ui?.suggestions} onClick={() => act((e) => e.rejectAll())} />
          </Group>
        </TabsContent>
        <TabsContent value="view" className="flex">
          <Group label={t('word.g.views')}>
            <Big label={t('word.printLayout')} icon={<FileText />} pressed={ui?.appearance.pageView !== 'continuous'} onClick={() => act((e) => e.setPageView('print'))} />
            <Big label={t('word.continuous')} icon={<ScrollText />} pressed={ui?.appearance.pageView === 'continuous'} onClick={() => act((e) => e.setPageView('continuous'))} />
          </Group>
          <Group label={t('word.g.show')}>
            <Big label={t('word.navigation')} icon={<PanelLeft />} pressed={panels.outline} onClick={() => a.togglePanel('outline')} />
            <Big label={t('word.commentPane')} icon={<PanelRight />} pressed={panels.review} onClick={() => a.togglePanel('review')} />
          </Group>
          <Group label={t('word.g.theme')}>
            <Big label={t('word.light')} icon={<Sun />} pressed={ui?.appearance.colorScheme !== 'dark'} onClick={() => act((e) => e.setColorScheme('light'))} />
            <Big label={t('word.dark')} icon={<Moon />} pressed={ui?.appearance.colorScheme === 'dark'} onClick={() => act((e) => e.setColorScheme('dark'))} />
          </Group>
          <Group label={t('app.language')}>
            {LOCALES.map((l) => (
              <Big key={l.id} label={l.label} icon={<Languages />} pressed={locale === l.id} onClick={() => setLocale(l.id)} />
            ))}
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
  const t = useT();
  return (
    <>
      <Group label={t('word.g.font')}>
        <Col>
          <Row>
            <Select items={FONTS.map((f) => ({ value: f, label: f }))} value={m?.font ?? null} onValueChange={(v) => v && act((e) => e.setMark('font', v === 'Pretendard' ? undefined : String(v)))}>
              <SelectTrigger size="sm" className="h-7 w-36 bg-background" aria-label={t('word.font')}>
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
              aria-label={t('word.fontSize')}
              className="h-7 w-11 rounded-md border bg-background text-center text-sm tabular-nums"
              defaultValue={size ?? ''}
              key={String(size)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSize(Number((e.target as HTMLInputElement).value));
              }}
            />
            <T label={t('word.grow')} onClick={() => setSize((size ?? 12) + 1)}>
              <Plus />
            </T>
            <T label={t('word.shrink')} onClick={() => setSize((size ?? 12) - 1)}>
              <Minus />
            </T>
            <T label={t('word.clear')} onClick={() => act((e) => e.clearMarks())}>
              <Eraser />
            </T>
          </Row>
          <Row>
            <T label={t('attr.bold')} shortcut="Ctrl+B" pressed={m?.bold} onClick={() => act((e) => e.toggleMark('bold'))}>
              <Bold />
            </T>
            <T label={t('word.italic')} shortcut="Ctrl+I" pressed={m?.italic} onClick={() => act((e) => e.toggleMark('italic'))}>
              <Italic />
            </T>
            <T label={t('attr.underline')} shortcut="Ctrl+U" pressed={m?.underline} onClick={() => act((e) => e.toggleMark('underline'))}>
              <Underline />
            </T>
            <T label={t('attr.strike')} pressed={m?.strike} onClick={() => act((e) => e.toggleMark('strike'))}>
              <Strikethrough />
            </T>
            <T label={t('attr.sub')} pressed={m?.script === 'sub'} onClick={() => act((e) => e.toggleScript('sub'))}>
              <Subscript />
            </T>
            <T label={t('attr.sup')} pressed={m?.script === 'sup'} onClick={() => act((e) => e.toggleScript('sup'))}>
              <Superscript />
            </T>
            <ColorPopover label={t('word.highlight')} icon={<Highlighter />} value={m?.highlight ?? null} colors={HIGHLIGHTS} none={t('word.noColor')} onPick={(c) => act((e) => e.setMark('highlight', c ?? undefined))} />
            <ColorPopover label={t('word.fontColor')} icon={<Baseline />} value={m?.color ?? null} colors={COLORS} none={t('word.automatic')} onPick={(c) => act((e) => e.setMark('color', c ?? undefined))} />
          </Row>
        </Col>
      </Group>
      <Group label={t('word.g.paragraph')}>
        <Col>
          <Row>
            <T label={t('word.bullets')} pressed={p?.list === 'bullet'} onClick={() => act((e) => e.toggleList('bullet'))}>
              <List />
            </T>
            <T label={t('word.numbering')} pressed={p?.list === 'number'} onClick={() => act((e) => e.toggleList('number'))}>
              <ListOrdered />
            </T>
            <T label={t('word.outdent')} onClick={() => act((e) => e.indent(-1))}>
              <IndentDecrease />
            </T>
            <T label={t('word.indent')} onClick={() => act((e) => e.indent(1))}>
              <IndentIncrease />
            </T>
            <T label={t('word.marks')} pressed={!!ui?.formatMarks} onClick={() => act((e) => e.setShowMarks(!ui?.formatMarks))}>
              <Pilcrow />
            </T>
          </Row>
          <Row>
            {(
              [
                ['left', 'word.alignLeft', AlignLeft],
                ['center', 'word.alignCenter', AlignCenter],
                ['right', 'word.alignRight', AlignRight],
                ['justify', 'word.justify', AlignJustify],
              ] as const
            ).map(([al, label, Icon]) => (
              <T key={al} label={t(label)} pressed={p?.align === al} onClick={() => act((e) => e.setParagraphAttr('align', al === 'left' ? undefined : al))}>
                <Icon />
              </T>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-7 gap-0.5 px-1.5 text-xs" aria-label={t('word.lineSpacing')} {...keep} />}>
                <TextCursorInput className="size-4" />
                <ChevronDown className="size-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-36" finalFocus={false}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t('word.lineSpacing')}</DropdownMenuLabel>
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
      <Group label={t('word.g.styles')} className="gap-1">
        {STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            {...keep}
            onClick={() => act((e) => e.setParagraphStyle(s.id))}
            className={cn(
              'flex h-[58px] w-[82px] flex-col items-start justify-center overflow-hidden rounded-md border bg-background px-2 text-left hover:border-primary/50',
              p?.style === s.id && 'border-primary ring-2 ring-primary/20',
            )}
          >
            <span className={cn('max-w-full truncate text-sm leading-tight', s.id === 'h1' && 'text-base font-bold', s.id === 'h2' && 'font-bold', s.id === 'h3' && 'font-semibold', s.id === 'quote' && 'italic text-muted-foreground')}>가나Aa</span>
            <span className="max-w-full truncate text-[11px] text-muted-foreground">{t(`style.${s.id}` as AppMessageKey)}</span>
          </button>
        ))}
      </Group>
      <Group label={t('word.g.editing')}>
        <Col>
          <Small label={t('word.find')} icon={<Search className="size-3.5" />} onClick={() => a.find(false)} />
          <Small label={t('word.replace')} icon={<Replace className="size-3.5" />} onClick={() => a.find(true)} />
          <Small label={t('word.spelling')} icon={<Languages className="size-3.5" />} pressed={!!ui?.spell} onClick={a.toggleSpell} />
        </Col>
      </Group>
    </>
  );
}

const MARGINS: Array<[AppMessageKey, number]> = [
  ['word.marginNormal', 25.4],
  ['word.marginNarrow', 12.7],
  ['word.marginWide', 38.1],
];

function LayoutTab({ ui, act, a, editor }: { ui: Ui | null; act: Act; a: RibbonActions; editor: Editor | null }) {
  const form = editor ? pageFormOf(editor.sectionInfo().props) : null;
  const p = ui?.para;
  const t = useT();
  const apply = (patch: (f: NonNullable<typeof form>) => void) =>
    act((e) => {
      const f = pageFormOf(e.sectionInfo().props);
      patch(f);
      applyPageForm(e, f);
    });
  return (
    <>
      <Group label={t('word.pageSetup')}>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="flex h-[62px] flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!" {...keep} />}>
            <RectangleVertical />
            {t('word.margins')}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48" finalFocus={false}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('word.margins')}</DropdownMenuLabel>
              {MARGINS.map(([label, mm]) => (
                <DropdownMenuItem key={label} onClick={() => apply((f) => void (f.margin = [mm, mm, mm, mm]))}>
                  {t(label)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={a.pageSetup}>{t('word.customMargins')}</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="flex h-[62px] flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!" {...keep} />}>
            {form?.orientation === 'landscape' ? <RectangleHorizontal /> : <RectangleVertical />}
            {t('word.orientation')}
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
                  {o === 'portrait' ? t('page.portrait') : t('page.landscape')}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="flex h-[62px] flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!" {...keep} />}>
            <FileText />
            {t('word.size')}
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
            <Columns2 />
            {t('word.columns')}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-32" finalFocus={false}>
            <DropdownMenuGroup>
              {[1, 2, 3].map((n) => (
                <DropdownMenuItem key={n} onClick={() => apply((f) => void (f.columns = n))}>
                  {form?.columns === n ? '✓ ' : ''}
                  {t('page.columnsN', { count: n })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Col>
          <Small label={t('word.breaks')} icon={<SeparatorHorizontal className="size-3.5" />} onClick={() => act((e) => e.insertPageBreak())} />
          <Small label={t('word.pageSetupDots')} icon={<PanelTop className="size-3.5" />} onClick={a.pageSetup} />
        </Col>
      </Group>
      <Group label={t('word.g.pagination')}>
        <Col>
          <Small label={t('word.pageBreakBefore')} icon={<span className="size-3.5" />} pressed={!!p?.pageBreakBefore} onClick={() => act((e) => e.toggleParagraphKeep('pageBreakBefore'))} />
          <Small label={t('word.keepWithNext')} icon={<span className="size-3.5" />} pressed={!!p?.keepWithNext} onClick={() => act((e) => e.toggleParagraphKeep('keepWithNext'))} />
          <Small label={t('word.keepTogether')} icon={<span className="size-3.5" />} pressed={!!p?.keepTogether} onClick={() => act((e) => e.toggleParagraphKeep('keepTogether'))} />
        </Col>
      </Group>
      <Group label={t('format.korean')}>
        <Col>
          <Small label={t('word.breakChar')} icon={<span className="size-3.5" />} pressed={p?.koreanBreak === 'char'} onClick={() => act((e) => e.setParagraphAttr('koreanBreak', p?.koreanBreak === 'char' ? undefined : 'char'))} />
          <Small label={t('format.hangPunct')} icon={<span className="size-3.5" />} pressed={!!p?.hangPunct} onClick={() => act((e) => e.setParagraphAttr('hangPunct', p?.hangPunct ? undefined : true))} />
          <Small label={t('format.squeeze')} icon={<span className="size-3.5" />} pressed={!!p?.squeeze} onClick={() => act((e) => e.setParagraphAttr('squeeze', p?.squeeze ? undefined : true))} />
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
  const t = useT();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" className="flex h-[62px] flex-col gap-1 px-2 text-xs font-normal [&_svg]:size-6!" {...keep} />}>
        <Table />
        {t('word.table')}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" initialFocus={false} finalFocus={false}>
        <div className="mb-1.5 text-xs text-muted-foreground">{hover[0] ? t('word.tableSize', { cols: hover[1], rows: hover[0] }) : t('word.insertTable')}</div>
        <div className="grid grid-cols-10 gap-0.5" onMouseLeave={() => setHover([0, 0])}>
          {Array.from({ length: 80 }, (_, i) => {
            const r = Math.floor(i / 10) + 1;
            const c = (i % 10) + 1;
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
                className={cn('size-4 border', on ? 'border-primary bg-primary/20' : 'bg-background')}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
