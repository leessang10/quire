'use client';
/**
 * Quire 예제 · Word식 (Next.js + Tailwind + shadcn/ui): 파란 제목 줄과 빠른 실행, 리본(홈·삽입·레이아웃·검토·보기),
 * 탐색 창, 인쇄 모양의 쪽, Word식 상태 줄. 편집 로직은 next-shadcn(Google Docs식)과 같고 화면만 다르다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Download, FilePlus, FileText, FolderOpen, PanelTop, Printer, Redo2, Save, ScrollText, Sparkles, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { QuireEditor, useEditorState, useQuire } from '@quire/react';
import { highlightWordsPlugin, wordCountPlugin, type Editor, type MenuItem as PluginMenuItem, type SpellMenu, type WordCount } from '@quire/editor';
import { safeLink } from '@quire/model';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { fonts } from '@/lib/quire-demo';
import { DemoSpellChecker, OPEN_ACCEPT, SAMPLES, SAVE_FORMATS, documentTitle, emptyDoc, openAny, openPdf, sampleDocument, saveAny, tourDoc, type SaveFormat } from '@/lib/quire-app';
import { useAct, useUi } from '@/lib/use-ui';
import { I18nProvider, LOCALES, initialLocale, useI18n, type Locale, type T } from '@/lib/i18n';
import type { AppMessageKey } from '@/lib/messages';
import { Ribbon } from './Ribbon';
import { ContextBar } from './ContextBar';
import { FindCard, OutlinePanel, ReviewPanel } from './Panels';
import { InfoDialog, PageSetupDialog, PromptDialog, ShortcutsBody, WordCountBody } from './Dialogs';

type DialogKind = 'page' | 'link' | 'alt' | 'count' | 'keys' | 'about' | 'report' | null;

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
  const { t, locale } = useI18n();
  const [count, setCount] = useState<WordCount | null>(null);
  const [find, setFind] = useState<{ replace: boolean; key: number } | null>(null);
  const [panels, setPanels] = useState({ outline: false, review: true });
  const [composing, setComposing] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [report, setReport] = useState<{ name: string; dropped: Record<string, number> } | null>(null);
  const [ctx, setCtx] = useState<{ spell: SpellMenu | null; items: PluginMenuItem[] }>({ spell: null, items: [] });
  const spell = useMemo(() => new DemoSpellChecker(), []);
  const ctl = useQuire({
    fonts,
    // Word식: 클래식 테마, 쪽마다 종이 (인쇄 모양)
    theme: 'classic',
    pageView: 'print',
    locale,
    plugins: [wordCountPlugin((c) => setCount(c)), highlightWordsPlugin(['Quire'])],
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
  const title = ctl.handle ? documentTitle(ctl.handle, t('app.untitled')) : 'Quire';

  // 화면 색: 편집기의 색 모드를 앱(shadcn .dark)에도 — 리본·제목 줄·상태 줄까지 어둡게
  const dark = ui?.appearance.colorScheme === 'dark';
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // 앱 언어를 바꾸면 편집기 화면 글(캔버스 표시·접근성 이름)도 같이
  useEffect(() => {
    editor?.setLocale(locale);
  }, [editor, locale]);

  const load: typeof ctl.load = useCallback(
    (doc, assets) =>
      ctl.load(doc, assets).then(() => {
        ctl.run('wordCount.report');
        setTimeout(() => ctl.handle?.editor.focus(), 0);
      }),
    [ctl],
  );

  useEffect(() => {
    (window as unknown as { quire: unknown }).quire = ctl;
    void tourDoc().then(({ doc, assets }) => load(doc, assets));
  }, [ctl, load]);

  const actions = {
    newDoc: () => void load(emptyDoc()).then(() => toast(t('toast.newDoc'))),
    tour: () => void tourDoc().then(({ doc, assets }) => load(doc, assets)),
    sample: (id: string) =>
      void sampleDocument(id)
        .then((d) => load(d))
        .then(() => toast(t('toast.sample', { name: t(`sample.${id}` as AppMessageKey) })))
        .catch((e: unknown) => toast.error(String(e))),
    open: () => fileInput.current?.click(),
    save: (kind: SaveFormat) => {
      const h = ctl.handle;
      if (!h) return;
      const format = SAVE_FORMATS.find((f) => f.kind === kind);
      toast.promise(saveAny(h, kind, documentTitle(h, t('app.untitled'))), {
        loading: t('toast.saving'),
        success: (n) => t('toast.saved', { format: format ? formatLabel(t, format) : kind, size: (n / 1024).toFixed(1) }),
        error: (e) => t('toast.saveFailed', { error: String(e) }),
      });
    },
    print: () => ctl.handle && void openPdf(ctl.handle),
    find: (replace: boolean) => setFind({ replace, key: Date.now() }),
    link: () => setDialog('link'),
    image: () => imageInput.current?.click(),
    comment: () => {
      if (!ui?.hasSelection) return void toast(t('word.needSelection'));
      setPanels((p) => ({ ...p, review: true }));
      setComposing(true);
    },
    pageSetup: () => setDialog('page'),
    wordCount: () => setDialog('count'),
    togglePanel: (p: 'outline' | 'review') => setPanels((s) => ({ ...s, [p]: !s[p] })),
    toggleSpell: () => act((e) => e.setSpellChecker(ui?.spell ? null : spell)),
  };

  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const a = actionsRef.current;
      if (!e.altKey && !e.shiftKey && k === 's') a.save('docx');
      else if (!e.altKey && !e.shiftKey && k === 'p') a.print();
      else if (!e.altKey && !e.shiftKey && k === 'o') a.open();
      else if (e.altKey && (k === 'm' || e.code === 'KeyM')) a.comment();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /** 파일 탭: Word의 Backstage 대신 shadcn DropdownMenu */
  const fileMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" className="h-7 rounded-md px-3" />}>{t('word.file')}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" finalFocus={false}>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={actions.newDoc}>
            <FilePlus /> {t('word.new')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={actions.open}>
            <FolderOpen /> {t('word.open')}
            <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <BookOpen /> {t('word.templates')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72">
              <DropdownMenuItem onClick={actions.tour}>
                <Sparkles /> {t('file.tour')}
              </DropdownMenuItem>
              {SAMPLES.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => actions.sample(s.id)}>
                  <FileText /> {t(`sample.${s.id}` as AppMessageKey)} <span className="text-xs text-muted-foreground">· {t(`sample.${s.id}.about` as AppMessageKey)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('word.saveAs')}</DropdownMenuLabel>
          {SAVE_FORMATS.map((f) => (
            <DropdownMenuItem key={f.kind} onClick={() => actions.save(f.kind)}>
              <Download /> {formatLabel(t, f)}
              <DropdownMenuShortcut>{f.kind === 'docx' ? 'Ctrl+S' : f.ext}</DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={actions.pageSetup}>
            <PanelTop /> {t('word.pageSetup')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={actions.print}>
            <Printer /> {t('file.print')}
            <DropdownMenuShortcut>Ctrl+P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('keys')}>{t('help.shortcuts')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('about')}>{t('help.about')}</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const quick = (label: string, icon: React.ReactNode, onClick: () => void, disabled?: boolean) => (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="rounded p-1 text-primary-foreground/90 hover:bg-white/15 disabled:opacity-40" />}>{icon}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  const s = ctx.spell;
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* 제목 줄: 빠른 실행 + 문서 이름 */}
      <div className="flex h-9 shrink-0 items-center gap-1 bg-primary px-3 text-primary-foreground">
        <FileText className="mr-1 size-4" />
        {quick(t('word.quickSave'), <Save className="size-4" />, () => actions.save('docx'))}
        {quick(t('edit.undo'), <Undo2 className="size-4" />, () => act((e) => e.undo()), !ui?.canUndo)}
        {quick(t('edit.redo'), <Redo2 className="size-4" />, () => act((e) => e.redo()), !ui?.canRedo)}
        <div className="flex-1 truncate text-center text-sm">
          {title} <span className="opacity-70">- Quire</span>
        </div>
        <span className="text-xs opacity-70">{t('word.badge')}</span>
      </div>
      <Ribbon ui={ui} act={act} a={actions} editor={editor} panels={panels} file={fileMenu} />
      <main className="flex min-h-0 flex-1">
        {panels.outline && <OutlinePanel editor={editor} version={version} />}
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
                  <ContextMenuLabel className="text-destructive">{s.message ?? t(s.kind === 'spacing' ? 'menu.spacing' : 'menu.spelling')}</ContextMenuLabel>
                  {s.suggestions.map((g) => (
                    <ContextMenuItem key={g} className="font-semibold" onClick={() => act(() => s.apply(g))}>
                      {g}
                    </ContextMenuItem>
                  ))}
                  <ContextMenuItem onClick={() => act(() => s.ignore())}>{t('menu.ignoreAll')}</ContextMenuItem>
                  <ContextMenuItem onClick={() => act(() => s.addWord())}>{t('word.addWord')}</ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuGroup>
              <ContextMenuItem disabled={!ui?.hasSelection} onClick={actions.comment}>
                {t('word.newComment')}
              </ContextMenuItem>
              <ContextMenuItem onClick={actions.link}>{t('insert.link')}</ContextMenuItem>
              <ContextMenuItem onClick={actions.pageSetup}>{t('word.pageSetupDots')}</ContextMenuItem>
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
        {panels.review && <ReviewPanel editor={editor} version={version} composing={composing} onComposeDone={() => setComposing(false)} />}
      </main>
      {/* 상태 줄 (Word식) */}
      <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-muted/40 px-3 text-xs text-muted-foreground">
        <span>{ui ? t('word.pages', { count: ui.pages }) : '…'}</span>
        {count && <span>{t('word.words', { count: count.words })}</span>}
        <span>{LOCALES.find((l) => l.id === locale)?.label}</span>
        {ui?.suggesting && <span className="text-primary">{t('word.tracking')}</span>}
        {ui?.spell && <span>{t('word.checking')}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          {(
            [
              ['print', t('word.printLayout'), FileText],
              ['continuous', t('word.continuous'), ScrollText],
            ] as const
          ).map(([v, label, Icon]) => (
            <Tooltip key={v}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={label}
                    aria-pressed={ui?.appearance.pageView === v}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => act((e) => e.setPageView(v))}
                    className={cn('rounded p-1 hover:bg-muted', ui?.appearance.pageView === v && 'bg-muted text-foreground')}
                  />
                }
              >
                <Icon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </footer>

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
            toast.success(t('toast.opened', { name: f.name }));
            if (Object.keys(dropped).length) {
              setReport({ name: f.name, dropped });
              setDialog('report');
            }
          } catch (err) {
            toast.error(t('toast.openFailed', { error: err instanceof Error ? err.message : String(err) }));
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

      <PageSetupDialog editor={editor} open={dialog === 'page'} onClose={() => setDialog(null)} />
      <PromptDialog
        open={dialog === 'link'}
        title={t('word.insertLink')}
        description={t('link.description')}
        label={t('link.label')}
        placeholder="https://"
        initial={ui?.marks.link ?? ''}
        okLabel={t('dialog.ok')}
        removeLabel={ui?.marks.link ? t('word.removeLink') : undefined}
        validate={(v) => (!ui?.hasSelection && !ui?.marks.link ? t('link.needSelection') : v && !safeLink(v) ? t('link.invalid') : null)}
        onSubmit={(v) => act((e) => e.setMark('link', v ? safeLink(v)! : undefined))}
        onClose={() => setDialog(null)}
      />
      <PromptDialog open={dialog === 'alt'} title={t('word.altText')} description={t('alt.description')} label={t('alt.label')} initial={ui?.object?.alt ?? ''} onSubmit={(v) => act((e) => e.setObjectAttr('alt', v || undefined))} onClose={() => setDialog(null)} />
      <InfoDialog open={dialog === 'count'} title={t('word.wordCount')} onClose={() => setDialog(null)}>
        <WordCountBody count={count} pages={ui?.pages ?? 0} />
      </InfoDialog>
      <InfoDialog open={dialog === 'keys'} title={t('help.shortcuts')} wide onClose={() => setDialog(null)}>
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
          <p className="text-foreground">{t('word.about.lead')}</p>
          <p>{t('word.about.body')}</p>
          <p>{t('about.i18n')}</p>
        </div>
      </InfoDialog>
    </div>
  );
}
