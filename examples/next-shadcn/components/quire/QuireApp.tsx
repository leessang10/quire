'use client';
/**
 * Quire 전체 기능 예제 (Next.js App Router + Tailwind + shadcn/ui). 화면 조각은 모두 shadcn 컴포넌트,
 * 편집기 연결은 @quire/react의 useQuire·QuireEditor, 화면 상태는 useUi, 명령은 act(편집기 API를 부르고 포커스를 돌려줌).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FileText, MessageSquarePlus, PanelLeft, PanelRight } from 'lucide-react';
import { toast } from 'sonner';
import { QuireEditor, useEditorState, useQuire } from '@quire/react';
import { highlightWordsPlugin, wordCountPlugin, type Editor, type MenuItem as PluginMenuItem, type SpellMenu, type WordCount } from '@quire/editor';
import { safeLink } from '@quire/model';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { fonts } from '@/lib/quire-demo';
import { DemoSpellChecker, OPEN_ACCEPT, SAVE_FORMATS, documentTitle, emptyDoc, openAny, openPdf, sampleDocument, saveAny, tourDoc, type SaveFormat } from '@/lib/quire-app';
import { useAct, useUi } from '@/lib/use-ui';
import { I18nProvider, initialLocale, useI18n, type Locale, type T } from '@/lib/i18n';
import type { AppMessageKey } from '@/lib/messages';
import { AppMenubar } from './AppMenubar';
import { Toolbar } from './Toolbar';
import { ContextBar } from './ContextBar';
import { FindCard, OutlinePanel, ReviewPanel, StatusBar } from './Panels';
import { InfoDialog, PageSetupDialog, PromptDialog, ShortcutsBody, WordCountBody } from './Dialogs';

type DialogKind = 'page' | 'link' | 'alt' | 'count' | 'keys' | 'about' | 'report' | null;

/** 저장 형식 이름 (Quire·HWPX만 언어에 따라 다르다) */
export const formatLabel = (t: T, f: { kind: string; label: string }) => (f.kind === 'quire' ? t('format.quireDoc') : f.kind === 'hwpx' ? t('format.hwpxDoc') : f.label);

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
  const [panels, setPanels] = useState({ outline: true, review: true });
  const [composing, setComposing] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [report, setReport] = useState<{ name: string; dropped: Record<string, number> } | null>(null);
  /** 오른쪽 클릭: 편집기가 알려 준 맞춤법 메뉴·플러그인 항목 (메뉴는 ContextMenu가 연다) */
  const [ctx, setCtx] = useState<{ spell: SpellMenu | null; items: PluginMenuItem[] }>({ spell: null, items: [] });
  const spell = useMemo(() => new DemoSpellChecker(), []);
  const ctl = useQuire({
    fonts,
    locale,
    plugins: [wordCountPlugin((c) => setCount(c)), highlightWordsPlugin(['Quire'])],
    onFindRequest: (replace) => setFind({ replace, key: Date.now() }),
    onContextMenu: (_e, s, items) => {
      setCtx({ spell: s, items });
      // 기본 동작(브라우저 메뉴)은 감싼 ContextMenu가 막고 자기 메뉴를 연다
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

  // 앱 언어를 바꾸면 편집기 화면 글(캔버스 표시·접근성 이름)도 같이
  useEffect(() => {
    editor?.setLocale(locale);
  }, [editor, locale]);

  // 문서를 바꾸면 글자 수 플러그인이 다시 세게 한다 (편집할 때만 세므로)
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
    tour: () => void tourDoc().then(({ doc, assets }) => load(doc, assets).then(() => toast(t('toast.tour')))),
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
      if (!ui?.hasSelection) return void toast(t('toast.needSelection'));
      setPanels((p) => ({ ...p, review: true }));
      setComposing(true);
    },
    pageSetup: () => setDialog('page'),
    wordCount: () => setDialog('count'),
    shortcuts: () => setDialog('keys'),
    about: () => setDialog('about'),
    togglePanel: (p: 'outline' | 'review') => setPanels((s) => ({ ...s, [p]: !s[p] })),
    toggleSpell: () => act((e) => e.setSpellChecker(ui?.spell ? null : spell)),
  };

  // 단축키: 저장·인쇄·열기·댓글 (편집기가 쓰지 않는 것)
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const a = actionsRef.current;
      if (!e.altKey && !e.shiftKey && k === 's') a.save('quire');
      else if (!e.altKey && !e.shiftKey && k === 'p') a.print();
      else if (!e.altKey && !e.shiftKey && k === 'o') a.open();
      else if (e.altKey && (k === 'm' || e.code === 'KeyM')) a.comment();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const panelToggle = (p: 'outline' | 'review', label: string, icon: React.ReactNode) => (
    <Tooltip>
      <TooltipTrigger render={<Toggle size="sm" aria-label={label} pressed={panels[p]} onPressedChange={() => actions.togglePanel(p)} />}>{icon}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  const s = ctx.spell;
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="shrink-0 border-b px-4 pb-2 pt-2.5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-medium">{title}</h1>
              <Badge variant="secondary">{t('app.badge')}</Badge>
            </div>
            <AppMenubar ui={ui} act={act} a={actions} panels={panels} />
          </div>
          <div className="flex items-center gap-1">
            {panelToggle('outline', t('view.outline'), <PanelLeft />)}
            {panelToggle(
              'review',
              t('view.review'),
              <>
                <PanelRight />
                {ui && ui.threads + ui.suggestions > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{ui.threads + ui.suggestions}</Badge>}
              </>,
            )}
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('menu.addComment')} onClick={actions.comment} />}>
                <MessageSquarePlus />
              </TooltipTrigger>
              <TooltipContent>{t('menu.addCommentKey')}</TooltipContent>
            </Tooltip>
            <div className="ml-1 flex">
              <Button size="sm" className="rounded-r-none" onClick={() => actions.save('quire')}>
                {t('file.save')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="icon-sm" aria-label={t('file.saveAs')} className="rounded-l-none border-l border-primary-foreground/20" />}>
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52" finalFocus={false}>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t('file.download')}</DropdownMenuLabel>
                    {SAVE_FORMATS.map((f) => (
                      <DropdownMenuItem key={f.kind} onClick={() => actions.save(f.kind)}>
                        {formatLabel(t, f)}
                        <span className="ml-auto text-xs text-muted-foreground">{f.ext}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        <div className="mt-2">
          <Toolbar ui={ui} act={act} onLink={actions.link} onImage={actions.image} />
        </div>
      </header>
      <main className="flex min-h-0 flex-1">
        {panels.outline && <OutlinePanel editor={editor} version={version} />}
        <ContextMenu>
          <ContextMenuTrigger render={<div className="relative min-w-0 flex-1 bg-muted/60" />}>
            <QuireEditor editor={ctl} className="h-full" />
            <ContextBar ui={ui} act={act} onAlt={() => setDialog('alt')} />
            {find && <FindCard key={find.key} editor={editor} replace={find.replace} onClose={() => setFind(null)} />}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56" finalFocus={false}>
            {s && (
              <>
                <ContextMenuGroup>
                  <ContextMenuLabel className="text-destructive">{s.message ?? t(s.kind === 'spacing' ? 'menu.spacing' : s.kind === 'grammar' ? 'menu.grammar' : 'menu.spelling')}</ContextMenuLabel>
                  {s.suggestions.map((g) => (
                    <ContextMenuItem key={g} className="font-semibold" onClick={() => act(() => s.apply(g))}>
                      {g}
                    </ContextMenuItem>
                  ))}
                  {!s.suggestions.length && <ContextMenuItem disabled>{t('spell.noSuggestions')}</ContextMenuItem>}
                  <ContextMenuItem onClick={() => act(() => s.ignore())}>{t('menu.ignoreAll')}</ContextMenuItem>
                  <ContextMenuItem onClick={() => act(() => s.addWord())}>{t('spell.addWord')}</ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuGroup>
              <ContextMenuItem disabled={!ui?.hasSelection} onClick={actions.comment}>
                {t('menu.addComment')}
              </ContextMenuItem>
              <ContextMenuItem onClick={actions.link}>{t('insert.link')}</ContextMenuItem>
              <ContextMenuItem onClick={() => actions.find(false)}>{t('edit.find')}</ContextMenuItem>
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
      <StatusBar ui={ui} count={count} input={editor ? (editor.inputKind === 'editcontext' ? 'EditContext' : 'textarea') : ''} />

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
        title={t('link.title')}
        description={t('link.description')}
        label={t('link.label')}
        placeholder="https://"
        initial={ui?.marks.link ?? ''}
        okLabel={t('link.ok')}
        removeLabel={ui?.marks.link ? t('link.remove') : undefined}
        validate={(v) => (!ui?.hasSelection && !ui?.marks.link ? t('link.needSelection') : v && !safeLink(v) ? t('link.invalid') : null)}
        onSubmit={(v) => act((e) => e.setMark('link', v ? safeLink(v)! : undefined))}
        onClose={() => setDialog(null)}
      />
      <PromptDialog
        open={dialog === 'alt'}
        title={t('alt.title')}
        description={t('alt.description')}
        label={t('alt.label')}
        initial={ui?.object?.alt ?? ''}
        onSubmit={(v) => act((e) => e.setObjectAttr('alt', v || undefined))}
        onClose={() => setDialog(null)}
      />
      <InfoDialog open={dialog === 'count'} title={t('count.title')} description={t('count.description')} onClose={() => setDialog(null)}>
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
          <p className="text-foreground">{t('about.lead')}</p>
          <p>{t('about.body')}</p>
          <p>{t('about.i18n')}</p>
          <p>{t('about.sync')}</p>
        </div>
      </InfoDialog>
    </div>
  );
}
