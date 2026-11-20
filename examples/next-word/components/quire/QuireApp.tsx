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
import { Ribbon } from './Ribbon';
import { ContextBar } from './ContextBar';
import { FindCard, OutlinePanel, ReviewPanel } from './Panels';
import { InfoDialog, PageSetupDialog, PromptDialog, ShortcutsBody, WordCountBody } from './Dialogs';

type DialogKind = 'page' | 'link' | 'alt' | 'count' | 'keys' | 'about' | 'report' | null;

export default function QuireApp() {
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
  const title = ctl.handle ? documentTitle(ctl.handle) : 'Quire';

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
    tour: () => void tourDoc().then(({ doc, assets }) => load(doc, assets)),
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
      if (!ui?.hasSelection) return void toast('먼저 메모를 달 글을 고르세요');
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
      <DropdownMenuTrigger render={<Button size="sm" className="h-7 rounded-md px-3" />}>파일</DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" finalFocus={false}>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={actions.newDoc}>
            <FilePlus /> 새로 만들기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={actions.open}>
            <FolderOpen /> 열기
            <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <BookOpen /> 서식 파일 (예제 문서)
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72">
              <DropdownMenuItem onClick={actions.tour}>
                <Sparkles /> 기능 둘러보기
              </DropdownMenuItem>
              {SAMPLES.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => actions.sample(s.id)}>
                  <FileText /> {s.label} <span className="text-xs text-muted-foreground">· {s.about}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>다른 이름으로 저장</DropdownMenuLabel>
          {SAVE_FORMATS.map((f) => (
            <DropdownMenuItem key={f.kind} onClick={() => actions.save(f.kind)}>
              <Download /> {f.label}
              <DropdownMenuShortcut>{f.kind === 'docx' ? 'Ctrl+S' : f.ext}</DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={actions.pageSetup}>
            <PanelTop /> 페이지 설정
          </DropdownMenuItem>
          <DropdownMenuItem onClick={actions.print}>
            <Printer /> 인쇄 (PDF)
            <DropdownMenuShortcut>Ctrl+P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('keys')}>단축키</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('about')}>이 예제에 대해</DropdownMenuItem>
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
        {quick('저장 (Ctrl+S, Word)', <Save className="size-4" />, () => actions.save('docx'))}
        {quick('실행 취소', <Undo2 className="size-4" />, () => act((e) => e.undo()), !ui?.canUndo)}
        {quick('다시 실행', <Redo2 className="size-4" />, () => act((e) => e.redo()), !ui?.canRedo)}
        <div className="flex-1 truncate text-center text-sm">
          {title} <span className="opacity-70">- Quire</span>
        </div>
        <span className="text-xs opacity-70">Word식 예제</span>
      </div>
      <Ribbon ui={ui} act={act} a={actions} editor={editor} panels={panels} file={fileMenu} />
      <ContextBar ui={ui} act={act} onAlt={() => setDialog('alt')} />
      <main className="flex min-h-0 flex-1">
        {panels.outline && <OutlinePanel editor={editor} version={version} />}
        <ContextMenu>
          <ContextMenuTrigger render={<div className="relative min-w-0 flex-1" />}>
            <QuireEditor editor={ctl} className="h-full" />
            {find && <FindCard key={find.key} editor={editor} replace={find.replace} onClose={() => setFind(null)} />}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56" finalFocus={false}>
            {s && (
              <>
                <ContextMenuGroup>
                  <ContextMenuLabel className="text-destructive">{s.message ?? (s.kind === 'spacing' ? '띄어쓰기' : '맞춤법')}</ContextMenuLabel>
                  {s.suggestions.map((g) => (
                    <ContextMenuItem key={g} className="font-semibold" onClick={() => act(() => s.apply(g))}>
                      {g}
                    </ContextMenuItem>
                  ))}
                  <ContextMenuItem onClick={() => act(() => s.ignore())}>모두 무시</ContextMenuItem>
                  <ContextMenuItem onClick={() => act(() => s.addWord())}>사전에 추가</ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuGroup>
              <ContextMenuItem disabled={!ui?.hasSelection} onClick={actions.comment}>
                새 메모
              </ContextMenuItem>
              <ContextMenuItem onClick={actions.link}>링크…</ContextMenuItem>
              <ContextMenuItem onClick={actions.pageSetup}>페이지 설정…</ContextMenuItem>
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
        <span>{ui ? `${ui.pages.toLocaleString()}페이지` : '…'}</span>
        {count && <span>단어 {count.words.toLocaleString()}개</span>}
        <span>한국어</span>
        {ui?.suggesting && <span className="text-primary">변경 내용 추적: 켜짐</span>}
        {ui?.spell && <span>맞춤법 검사 중</span>}
        <div className="ml-auto flex items-center gap-0.5">
          {(
            [
              ['print', '인쇄 모양', FileText],
              ['continuous', '연속 보기', ScrollText],
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
        title="하이퍼링크 삽입"
        description="고른 글에 링크를 겁니다. http, https, mailto, tel 주소만 걸 수 있습니다."
        label="주소"
        placeholder="https://"
        initial={ui?.marks.link ?? ''}
        okLabel="확인"
        removeLabel={ui?.marks.link ? '링크 제거' : undefined}
        validate={(v) => (!ui?.hasSelection && !ui?.marks.link ? '먼저 링크를 걸 글을 고르세요.' : v && !safeLink(v) ? '걸 수 없는 주소입니다.' : null)}
        onSubmit={(v) => act((e) => e.setMark('link', v ? safeLink(v)! : undefined))}
        onClose={() => setDialog(null)}
      />
      <PromptDialog open={dialog === 'alt'} title="대체 텍스트" description="화면 읽기 프로그램이 그림 대신 읽는 설명입니다." label="설명" initial={ui?.object?.alt ?? ''} onSubmit={(v) => act((e) => e.setObjectAttr('alt', v || undefined))} onClose={() => setDialog(null)} />
      <InfoDialog open={dialog === 'count'} title="단어 개수" onClose={() => setDialog(null)}>
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
          <p className="text-foreground">Quire 편집기를 Word식 화면으로 꾸민 예제입니다 (Next.js + Tailwind + shadcn/ui).</p>
          <p>같은 편집기로 Google Docs식(next-shadcn), Notion식(next-notion) 화면도 만들 수 있습니다. 편집기는 화면 틀을 정하지 않고, 테마(CSS 변수)·쪽 보기·API만 준다.</p>
        </div>
      </InfoDialog>
    </div>
  );
}
