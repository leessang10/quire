'use client';
/**
 * Quire 예제 · Notion식 (Next.js + Tailwind + shadcn/ui): 왼쪽 페이지 목록, 도구 막대 없이 연속 보기(쪽 경계 없음),
 * 글을 고르면 뜨는 서식 막대, `/` 명령 메뉴, 오른쪽 위 `···` 메뉴. 편집기는 미니멀 테마 + 연속 보기.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Download, FileText, FolderOpen, Languages, Minus, Moon, MoreHorizontal, MessageSquare, Plus, Printer, ScrollText, Search, Sparkles, Sun, Type } from 'lucide-react';
import { toast } from 'sonner';
import { QuireEditor, useEditorState, useQuire } from '@quire/react';
import { highlightWordsPlugin, wordCountPlugin, type Editor, type MenuItem as PluginMenuItem, type SpellMenu, type WordCount } from '@quire/editor';
import { safeLink } from '@quire/model';
import type { QuireDoc } from '@quire/sdk';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { fonts } from '@/lib/quire-demo';
import { DemoSpellChecker, OPEN_ACCEPT, SAMPLES, SAVE_FORMATS, documentTitle, openAny, openPdf, sampleDocument, saveAny, tourDoc, zoomPercent, zoomStep, type SaveFormat } from '@/lib/quire-app';
import { useAct, useUi } from '@/lib/use-ui';
import { I18nProvider, LOCALES, initialLocale, useI18n, type Locale, type T } from '@/lib/i18n';
import type { AppMessageKey } from '@/lib/messages';
import { ContextBar } from './ContextBar';
import { FindCard, ReviewPanel } from './Panels';
import { InfoDialog, PromptDialog, ShortcutsBody, WordCountBody } from './Dialogs';
import { FloatingBar } from './FloatingBar';
import { SlashMenu, slashCommands } from './SlashMenu';

type DialogKind = 'link' | 'alt' | 'count' | 'keys' | 'about' | 'report' | null;

/** 새 페이지: 비어 있는 제목 1과 본문 한 줄 */
function newPage(title: string): QuireDoc {
  return { format: 'quire', version: 1, settings: {}, styles: {}, stories: { body: [{ p: { style: 'h1' }, c: [{ t: title }] }, { p: {}, c: [] }] }, annotations: [] } as unknown as QuireDoc;
}

/** 사이드바의 페이지: 기능 둘러보기와 예제 문서 (이름은 메시지 키) */
const PAGES: Array<{ id: string; label: AppMessageKey }> = [{ id: 'tour', label: 'notion.tourPage' }, ...SAMPLES.map((s) => ({ id: s.id, label: `sample.${s.id}` as AppMessageKey }))];

/** 저장 형식 이름 (Quire·HWPX만 언어에 따라 다르다) */
const formatLabel = (t: T, f: { kind: string; label: string }) => (f.kind === 'quire' ? t('format.quireDoc') : f.kind === 'hwpx' ? t('format.hwpxDoc') : f.label);

/** 바깥: 화면 언어를 정하고 메시지를 내려 준다 */
export default function QuireApp() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  return (
    <I18nProvider locale={locale} onChange={setLocale}>
      <App />
    </I18nProvider>
  );
}

function App() {
  const { t, locale, setLocale } = useI18n();
  const [count, setCount] = useState<WordCount | null>(null);
  const [find, setFind] = useState<{ replace: boolean; key: number } | null>(null);
  const [comments, setComments] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [report, setReport] = useState<{ name: string; dropped: Record<string, number> } | null>(null);
  const [page, setPage] = useState('tour');
  const [extra, setExtra] = useState<string[]>([]);
  const [ctx, setCtx] = useState<{ spell: SpellMenu | null; items: PluginMenuItem[] }>({ spell: null, items: [] });
  const spell = useMemo(() => new DemoSpellChecker(), []);
  const ctl = useQuire({
    fonts,
    // Notion식: 장식 없는 테마, 쪽 경계 없이 이어서
    theme: 'minimal',
    pageView: 'continuous',
    locale,
    // 강조 낱말: 밝고 어두운 화면 모두에서 읽히는 반투명 노랑
    plugins: [wordCountPlugin((c) => setCount(c)), highlightWordsPlugin(['Quire'], 'rgba(255, 196, 0, 0.32)')],
    onFindRequest: (replace) => setFind({ replace, key: Date.now() }),
    onContextMenu: (_e, s, items) => {
      setCtx({ spell: s, items });
      return false;
    },
  });
  const ui = useUi(ctl);
  const version = useEditorState(ctl, (s) => s.version);
  const act = useAct(ctl);
  const editor = (ctl.handle?.editor as Editor | undefined) ?? null;
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const title = ctl.handle ? documentTitle(ctl.handle, t('notion.untitled')) : 'Quire';

  // 앱 언어를 바꾸면 편집기 화면 글(캔버스 표시·접근성 이름)도 같이
  useEffect(() => {
    editor?.setLocale(locale);
  }, [editor, locale]);
  const dark = ui?.appearance.colorScheme === 'dark';

  const load: typeof ctl.load = useCallback(
    (doc, assets) =>
      ctl.load(doc, assets).then(() => {
        ctl.run('wordCount.report');
        setTimeout(() => ctl.handle?.editor.focus(), 0);
      }),
    [ctl],
  );

  // 새 페이지 제목: 언어가 바뀌어도 openPage(첫 화면 효과)는 그대로 두려고 ref로
  const untitled = useRef('');
  untitled.current = t('notion.untitled');

  const openPage = useCallback(
    (id: string) => {
      setPage(id);
      if (id === 'tour') void tourDoc().then(({ doc, assets }) => load(doc, assets));
      else if (id.startsWith('new-')) void load(newPage(untitled.current));
      else void sampleDocument(id).then((d) => load(d));
    },
    [load],
  );

  useEffect(() => {
    (window as unknown as { quire: unknown }).quire = ctl;
    openPage('tour');
  }, [ctl, openPage]);

  // 화면 색: 앱(shadcn) 다크와 편집기 다크를 같이
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const actions = {
    open: () => fileInput.current?.click(),
    save: (kind: SaveFormat) => {
      const h = ctl.handle;
      if (!h) return;
      const format = SAVE_FORMATS.find((f) => f.kind === kind);
      toast.promise(saveAny(h, kind, documentTitle(h, t('notion.untitled'))), {
        loading: t('notion.exporting'),
        success: (n) => t('notion.exported', { format: format ? formatLabel(t, format) : kind, size: (n / 1024).toFixed(1) }),
        error: (e) => t('notion.exportFailed', { error: String(e) }),
      });
    },
    link: () => setDialog('link'),
    image: () => imageInput.current?.click(),
    comment: () => {
      if (!ui?.hasSelection) return void toast(t('toast.needSelection'));
      setComments(true);
      setComposing(true);
    },
  };
  const commands = useMemo(() => slashCommands(() => imageInput.current?.click(), t), [t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (!e.altKey && !e.shiftKey && k === 'p') ctl.handle && void openPdf(ctl.handle);
      else if (!e.altKey && !e.shiftKey && k === 'o') fileInput.current?.click();
      else if (!e.altKey && !e.shiftKey && k === 's') ctl.handle && void saveAny(ctl.handle, 'quire');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ctl]);

  const s = ctx.spell;
  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* 사이드바: 워크스페이스와 페이지 */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/40">
        <div className="flex items-center gap-2 px-3 py-3">
          <span className="flex size-6 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background">Q</span>
          <span className="truncate text-sm font-medium">{t('notion.workspace')}</span>
        </div>
        <div className="px-2">
          <button type="button" onClick={() => setFind({ replace: false, key: Date.now() })} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
            <Search className="size-4" /> {t('notion.search')}
          </button>
          <button
            type="button"
            onClick={() => {
              const id = `new-${Date.now()}`;
              setExtra((x) => [...x, id]);
              openPage(id);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-4" /> {t('notion.newPage')}
          </button>
        </div>
        <div className="px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">{t('notion.pages')}</div>
        <ScrollArea className="min-h-0 flex-1 px-2">
          {[...PAGES.map((p) => ({ id: p.id, label: t(p.label) })), ...extra.map((id, i) => ({ id, label: i === 0 ? t('notion.untitled') : t('notion.untitledN', { n: i + 1 }) }))].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openPage(p.id)}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted', page === p.id && 'bg-muted font-medium')}
            >
              {p.id === 'tour' ? <Sparkles className="size-4 shrink-0 text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
              <span className="truncate">{p.label}</span>
            </button>
          ))}
        </ScrollArea>
        <div className="border-t p-2">
          <button type="button" onClick={() => act((e) => e.setColorScheme(dark ? 'light' : 'dark'))} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />} {dark ? t('notion.light') : t('notion.dark')}
          </button>
          {/* 화면 언어: 앱과 편집기를 같이 (편집기는 App의 effect가 setLocale) */}
          <button
            type="button"
            onClick={() => setLocale(locale === 'en' ? 'ko' : 'en')}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            <Languages className="size-4" /> {t('app.language')}
            <span className="ml-auto text-xs">{LOCALES.find((l) => l.id === locale)?.label}</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 위쪽 줄: 경로와 메뉴 */}
        <header className="flex h-11 shrink-0 items-center gap-1 px-3 text-sm">
          <span className="text-muted-foreground">Quire</span>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="truncate">{title}</span>
          <div className="ml-auto flex items-center gap-1">
            {ui && ui.suggesting && <span className="mr-2 text-xs text-emerald-600">{t('notion.suggesting')}</span>}
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('notion.comments')} aria-pressed={comments} onClick={() => setComments(!comments)} />}>
                <MessageSquare />
              </TooltipTrigger>
              <TooltipContent>{t('notion.commentsTip')}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('notion.more')} />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60" finalFocus={false}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{count ? t('notion.counts', { words: count.words, chars: count.chars }) : t('notion.document')}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem checked={ui?.appearance.pageView === 'print'} onCheckedChange={() => act((e) => e.setPageView(ui?.appearance.pageView === 'print' ? 'continuous' : 'print'))}>
                    {t('notion.printView')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={!!ui?.suggesting} onCheckedChange={() => act((e) => e.setSuggesting(!ui?.suggesting))}>
                    {t('notion.suggesting')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={!!ui?.formatMarks} onCheckedChange={() => act((e) => e.setShowMarks(!ui?.formatMarks))}>
                    {t('view.formatMarks')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={!!ui?.spell} onCheckedChange={() => act((e) => e.setSpellChecker(ui?.spell ? null : spell))}>
                    {t('notion.spell')}
                  </DropdownMenuCheckboxItem>
                  {/* 확대·축소: 메뉴를 닫지 않고 여러 번 누를 수 있게 항목이 아닌 줄로 */}
                  <div className="flex items-center gap-1 py-0.5 pr-1 pl-1.5 text-sm" role="group" aria-label={t('zoom.label')}>
                    <span className="flex-1">{t('zoom.label')}</span>
                    <Button variant="ghost" size="icon-xs" aria-label={t('zoom.out')} onClick={() => act((e) => e.setZoom(zoomStep(e.zoom, -1)))}>
                      <Minus />
                    </Button>
                    <button type="button" title={t('zoom.reset')} className="w-11 rounded text-center text-xs tabular-nums text-muted-foreground hover:text-foreground" onClick={() => act((e) => e.setZoom(1))}>
                      {zoomPercent(ui?.zoom ?? 1)}
                    </button>
                    <Button variant="ghost" size="icon-xs" aria-label={t('zoom.in')} onClick={() => act((e) => e.setZoom(zoomStep(e.zoom, 1)))}>
                      <Plus />
                    </Button>
                  </div>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={actions.open}>
                    <FolderOpen /> {t('notion.import')}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Download /> {t('notion.export')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-52">
                      {SAVE_FORMATS.map((f) => (
                        <DropdownMenuItem key={f.kind} onClick={() => actions.save(f.kind)}>
                          {formatLabel(t, f)}
                          <span className="ml-auto text-xs text-muted-foreground">{f.ext}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onClick={() => ctl.handle && void openPdf(ctl.handle)}>
                    <Printer /> {t('file.print')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setDialog('count')}>
                    <Type /> {t('notion.wordCount')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDialog('keys')}>
                    <ScrollText /> {t('help.shortcuts')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDialog('about')}>{t('help.about')}</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex min-h-0 flex-1">
          <ContextMenu>
            <ContextMenuTrigger render={<div className="relative min-w-0 flex-1" />}>
              <QuireEditor editor={ctl} className="h-full" />
              <ContextBar ui={ui} act={act} onAlt={() => setDialog('alt')} />
              {find && <FindCard key={find.key} editor={editor} replace={find.replace} onClose={() => setFind(null)} />}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56" finalFocus={false}>
              {s && (
                <>
                  <ContextMenuGroup>
                    <ContextMenuLabel className="text-destructive">{s.message ?? t('menu.spelling')}</ContextMenuLabel>
                    {s.suggestions.map((g) => (
                      <ContextMenuItem key={g} className="font-semibold" onClick={() => act(() => s.apply(g))}>
                        {g}
                      </ContextMenuItem>
                    ))}
                    <ContextMenuItem onClick={() => act(() => s.ignore())}>{t('notion.ignore')}</ContextMenuItem>
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuGroup>
                <ContextMenuItem disabled={!ui?.hasSelection} onClick={actions.comment}>
                  {t('notion.comment')}
                </ContextMenuItem>
                <ContextMenuItem onClick={actions.link}>{t('insert.link')}</ContextMenuItem>
              </ContextMenuGroup>
              {ctx.items.length > 0 && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuGroup>
                    {ctx.items.map((it, i) => (
                      <ContextMenuItem key={i} disabled={!!it.disabled} onClick={() => act(() => it.run())}>
                        {it.label}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuGroup>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
          {comments && <ReviewPanel editor={editor} version={version} composing={composing} onComposeDone={() => setComposing(false)} />}
        </main>
      </div>

      <FloatingBar ctl={ctl} ui={ui} version={version} act={act} onLink={actions.link} onComment={actions.comment} hidden={dialog !== null} />
      <SlashMenu ctl={ctl} version={version} commands={commands} />

      <input
        ref={fileInput}
        type="file"
        accept={OPEN_ACCEPT}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || !ctl.handle) return;
          try {
            const dropped = await openAny(ctl.handle, f);
            ctl.run('wordCount.report');
            toast.success(t('notion.imported', { name: f.name }));
            if (Object.keys(dropped).length) {
              setReport({ name: f.name, dropped });
              setDialog('report');
            }
          } catch (err) {
            toast.error(t('notion.importFailed', { error: err instanceof Error ? err.message : String(err) }));
          }
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) act((ed) => ed.insertImage(f));
        }}
      />

      <PromptDialog
        open={dialog === 'link'}
        title={t('link.title')}
        label={t('link.label')}
        placeholder="https://"
        initial={ui?.marks.link ?? ''}
        okLabel={t('link.ok')}
        removeLabel={ui?.marks.link ? t('link.remove') : undefined}
        validate={(v) => (!ui?.hasSelection && !ui?.marks.link ? t('link.needSelection') : v && !safeLink(v) ? t('link.invalid') : null)}
        onSubmit={(v) => act((e) => e.setMark('link', v ? safeLink(v)! : undefined))}
        onClose={() => setDialog(null)}
      />
      <PromptDialog open={dialog === 'alt'} title={t('alt.title')} label={t('alt.label')} initial={ui?.object?.alt ?? ''} onSubmit={(v) => act((e) => e.setObjectAttr('alt', v || undefined))} onClose={() => setDialog(null)} />
      <InfoDialog open={dialog === 'count'} title={t('notion.wordCount')} onClose={() => setDialog(null)}>
        <WordCountBody count={count} pages={ui?.pages ?? 0} />
      </InfoDialog>
      <InfoDialog open={dialog === 'keys'} title={t('help.shortcuts')} wide onClose={() => setDialog(null)}>
        <p className="mb-2 text-muted-foreground">{t('notion.slashHint')}</p>
        <ShortcutsBody />
      </InfoDialog>
      <InfoDialog open={dialog === 'report'} title={t('report.title')} description={t('report.description', { name: report?.name ?? '' })} onClose={() => setDialog(null)}>
        <ul className="list-disc pl-5">
          {Object.entries(report?.dropped ?? {}).map(([k, n]) => (
            <li key={k}>{t('report.item', { what: k, count: n })}</li>
          ))}
        </ul>
      </InfoDialog>
      <InfoDialog open={dialog === 'about'} title={t('help.about')} wide onClose={() => setDialog(null)}>
        <div className="space-y-2 leading-6 text-muted-foreground">
          <p className="text-foreground">{t('notion.about.lead')}</p>
          <p>{t('notion.about.body')}</p>
          <p>{t('about.i18n')}</p>
        </div>
      </InfoDialog>
    </div>
  );
}
