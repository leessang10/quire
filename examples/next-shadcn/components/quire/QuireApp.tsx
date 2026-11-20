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
import { DemoSpellChecker, OPEN_ACCEPT, SAMPLES, SAVE_FORMATS, documentTitle, emptyDoc, openAny, openPdf, sampleDocument, saveAny, tourDoc, type SaveFormat } from '@/lib/quire-app';
import { useAct, useUi } from '@/lib/use-ui';
import { AppMenubar } from './AppMenubar';
import { Toolbar } from './Toolbar';
import { ContextBar } from './ContextBar';
import { FindCard, OutlinePanel, ReviewPanel, StatusBar } from './Panels';
import { InfoDialog, PageSetupDialog, PromptDialog, ShortcutsBody, WordCountBody } from './Dialogs';

type DialogKind = 'page' | 'link' | 'alt' | 'count' | 'keys' | 'about' | 'report' | null;

export default function QuireApp() {
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
  const title = ctl.handle ? documentTitle(ctl.handle) : 'Quire';

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
    newDoc: () => void load(emptyDoc()).then(() => toast('새 문서')),
    tour: () => void tourDoc().then(({ doc, assets }) => load(doc, assets).then(() => toast('기능 둘러보기 문서를 열었습니다'))),
    sample: (id: string) =>
      void sampleDocument(id)
        .then((d) => load(d))
        .then(() => toast(`예제 문서: ${SAMPLES.find((s) => s.id === id)?.label}`))
        .catch((e: unknown) => toast.error(String(e))),
    open: () => fileInput.current?.click(),
    save: (kind: SaveFormat) => {
      const h = ctl.handle;
      if (!h) return;
      toast.promise(saveAny(h, kind), {
        loading: '저장하는 중…',
        success: (n) => `${SAVE_FORMATS.find((f) => f.kind === kind)?.label}로 저장했습니다 (${(n / 1024).toFixed(1)} KB)`,
        error: (e) => `저장하지 못했습니다: ${String(e)}`,
      });
    },
    print: () => ctl.handle && void openPdf(ctl.handle),
    find: (replace: boolean) => setFind({ replace, key: Date.now() }),
    link: () => setDialog('link'),
    image: () => imageInput.current?.click(),
    comment: () => {
      if (!ui?.hasSelection) return void toast('먼저 댓글을 달 글을 고르세요');
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
              <Badge variant="secondary">전체 기능 예제</Badge>
            </div>
            <AppMenubar ui={ui} act={act} a={actions} panels={panels} />
          </div>
          <div className="flex items-center gap-1">
            {panelToggle('outline', '개요', <PanelLeft />)}
            {panelToggle(
              'review',
              '댓글·제안',
              <>
                <PanelRight />
                {ui && ui.threads + ui.suggestions > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{ui.threads + ui.suggestions}</Badge>}
              </>,
            )}
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="댓글 달기" onClick={actions.comment} />}>
                <MessageSquarePlus />
              </TooltipTrigger>
              <TooltipContent>댓글 달기 (Ctrl+Alt+M)</TooltipContent>
            </Tooltip>
            <div className="ml-1 flex">
              <Button size="sm" className="rounded-r-none" onClick={() => actions.save('quire')}>
                저장
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="icon-sm" aria-label="다른 형식으로 저장" className="rounded-l-none border-l border-primary-foreground/20" />}>
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52" finalFocus={false}>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>내려받기</DropdownMenuLabel>
                    {SAVE_FORMATS.map((f) => (
                      <DropdownMenuItem key={f.kind} onClick={() => actions.save(f.kind)}>
                        {f.label}
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
      <ContextBar ui={ui} act={act} onAlt={() => setDialog('alt')} />
      <main className="flex min-h-0 flex-1">
        {panels.outline && <OutlinePanel editor={editor} version={version} />}
        <ContextMenu>
          <ContextMenuTrigger render={<div className="relative min-w-0 flex-1 bg-muted/60" />}>
            <QuireEditor editor={ctl} className="h-full" />
            {find && <FindCard key={find.key} editor={editor} replace={find.replace} onClose={() => setFind(null)} />}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56" finalFocus={false}>
            {s && (
              <>
                <ContextMenuGroup>
                  <ContextMenuLabel className="text-destructive">{s.message ?? (s.kind === 'spacing' ? '띄어쓰기' : s.kind === 'grammar' ? '문법' : '맞춤법')}</ContextMenuLabel>
                  {s.suggestions.map((g) => (
                    <ContextMenuItem key={g} className="font-semibold" onClick={() => act(() => s.apply(g))}>
                      {g}
                    </ContextMenuItem>
                  ))}
                  {!s.suggestions.length && <ContextMenuItem disabled>고칠 말 없음</ContextMenuItem>}
                  <ContextMenuItem onClick={() => act(() => s.ignore())}>모두 무시</ContextMenuItem>
                  <ContextMenuItem onClick={() => act(() => s.addWord())}>사전에 더하기</ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuGroup>
              <ContextMenuItem disabled={!ui?.hasSelection} onClick={actions.comment}>
                댓글 달기
              </ContextMenuItem>
              <ContextMenuItem onClick={actions.link}>링크…</ContextMenuItem>
              <ContextMenuItem onClick={() => actions.find(false)}>찾기</ContextMenuItem>
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
            toast.success(`${f.name}을(를) 열었습니다`);
            if (Object.keys(dropped).length) {
              setReport({ name: f.name, dropped });
              setDialog('report');
            }
          } catch (err) {
            toast.error(`열지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
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
        title="링크"
        description="고른 글에 링크를 겁니다. http, https, mailto, tel 주소만 걸 수 있습니다."
        label="주소"
        placeholder="https://"
        initial={ui?.marks.link ?? ''}
        okLabel="걸기"
        removeLabel={ui?.marks.link ? '링크 지우기' : undefined}
        validate={(v) => (!ui?.hasSelection && !ui?.marks.link ? '먼저 링크를 걸 글을 고르세요.' : v && !safeLink(v) ? '걸 수 없는 주소입니다.' : null)}
        onSubmit={(v) => act((e) => e.setMark('link', v ? safeLink(v)! : undefined))}
        onClose={() => setDialog(null)}
      />
      <PromptDialog
        open={dialog === 'alt'}
        title="그림 대체 텍스트"
        description="화면 읽기 프로그램이 그림 대신 읽는 설명입니다."
        label="설명"
        initial={ui?.object?.alt ?? ''}
        onSubmit={(v) => act((e) => e.setObjectAttr('alt', v || undefined))}
        onClose={() => setDialog(null)}
      />
      <InfoDialog open={dialog === 'count'} title="글자 수" description="글자 수 플러그인(wordCountPlugin)이 센 본문 값입니다." onClose={() => setDialog(null)}>
        <WordCountBody count={count} pages={ui?.pages ?? 0} />
      </InfoDialog>
      <InfoDialog open={dialog === 'keys'} title="단축키" wide onClose={() => setDialog(null)}>
        <ShortcutsBody />
      </InfoDialog>
      <InfoDialog open={dialog === 'report'} title="가져오며 버린 요소" description={`${report?.name ?? ''}에서 Quire가 담지 못하는 요소를 버렸습니다.`} onClose={() => setDialog(null)}>
        <ul className="list-disc pl-5">
          {Object.entries(report?.dropped ?? {}).map(([k, n]) => (
            <li key={k}>
              {k}: {n}개
            </li>
          ))}
        </ul>
      </InfoDialog>
      <InfoDialog open={dialog === 'about'} title="이 예제에 대해" wide onClose={() => setDialog(null)}>
        <div className="space-y-2 leading-6 text-muted-foreground">
          <p className="text-foreground">Next.js App Router + Tailwind + shadcn/ui로 만든 Quire 전체 기능 예제입니다.</p>
          <p>
            편집기는 <code>@quire/react</code>의 <code>useQuire</code>·<code>QuireEditor</code>로 붙이고(브라우저에서만, <code>ssr: false</code>), 메뉴·도구 막대·대화상자는 모두 shadcn 컴포넌트입니다.
          </p>
          <p>실시간 협업·버전 이력은 동기화 서버가 필요해 넣지 않았습니다.</p>
        </div>
      </InfoDialog>
    </div>
  );
}
