'use client';
/**
 * Quire 예제 · Notion식 (Next.js + Tailwind + shadcn/ui): 왼쪽 페이지 목록, 도구 막대 없이 연속 보기(쪽 경계 없음),
 * 글을 고르면 뜨는 서식 막대, `/` 명령 메뉴, 오른쪽 위 `···` 메뉴. 편집기는 미니멀 테마 + 연속 보기.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Download, FileText, FolderOpen, Moon, MoreHorizontal, MessageSquare, Plus, Printer, ScrollText, Search, Sparkles, Sun, Type } from 'lucide-react';
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
import { DemoSpellChecker, OPEN_ACCEPT, SAMPLES, SAVE_FORMATS, documentTitle, openAny, openPdf, sampleDocument, saveAny, tourDoc, type SaveFormat } from '@/lib/quire-app';
import { useAct, useUi } from '@/lib/use-ui';
import { ContextBar } from './ContextBar';
import { FindCard, ReviewPanel } from './Panels';
import { InfoDialog, PromptDialog, ShortcutsBody, WordCountBody } from './Dialogs';
import { FloatingBar } from './FloatingBar';
import { SlashMenu, slashCommands } from './SlashMenu';

type DialogKind = 'link' | 'alt' | 'count' | 'keys' | 'about' | 'report' | null;

/** 새 페이지: 비어 있는 제목 1과 본문 한 줄 */
function newPage(): QuireDoc {
  return { format: 'quire', version: 1, settings: {}, styles: {}, stories: { body: [{ p: { style: 'h1' }, c: [{ t: '제목 없음' }] }, { p: {}, c: [] }] }, annotations: [] } as unknown as QuireDoc;
}

const PAGES: Array<{ id: string; label: string }> = [{ id: 'tour', label: 'Quire 기능 둘러보기' }, ...SAMPLES.map((s) => ({ id: s.id, label: s.label }))];

export default function QuireApp() {
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
  const title = ctl.handle ? documentTitle(ctl.handle) : 'Quire';
  const dark = ui?.appearance.colorScheme === 'dark';

  const load: typeof ctl.load = useCallback(
    (doc, assets) =>
      ctl.load(doc, assets).then(() => {
        ctl.run('wordCount.report');
        setTimeout(() => ctl.handle?.editor.focus(), 0);
      }),
    [ctl],
  );

  const openPage = useCallback(
    (id: string) => {
      setPage(id);
      if (id === 'tour') void tourDoc().then(({ doc, assets }) => load(doc, assets));
      else if (id.startsWith('new-')) void load(newPage());
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
      toast.promise(saveAny(h, kind), {
        loading: '내보내는 중…',
        success: (n) => `${SAVE_FORMATS.find((f) => f.kind === kind)?.label}로 내보냈습니다 (${(n / 1024).toFixed(1)} KB)`,
        error: (e) => `내보내지 못했습니다: ${String(e)}`,
      });
    },
    link: () => setDialog('link'),
    image: () => imageInput.current?.click(),
    comment: () => {
      if (!ui?.hasSelection) return void toast('먼저 댓글을 달 글을 고르세요');
      setComments(true);
      setComposing(true);
    },
  };
  const commands = useMemo(() => slashCommands(() => imageInput.current?.click()), []);

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
          <span className="truncate text-sm font-medium">Quire 워크스페이스</span>
        </div>
        <div className="px-2">
          <button type="button" onClick={() => setFind({ replace: false, key: Date.now() })} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
            <Search className="size-4" /> 찾기
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
            <Plus className="size-4" /> 새 페이지
          </button>
        </div>
        <div className="px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground">페이지</div>
        <ScrollArea className="min-h-0 flex-1 px-2">
          {[...PAGES, ...extra.map((id, i) => ({ id, label: i === 0 ? '제목 없음' : `제목 없음 ${i + 1}` }))].map((p) => (
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
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />} {dark ? '밝게' : '어둡게'}
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
            {ui && ui.suggesting && <span className="mr-2 text-xs text-emerald-600">제안 모드</span>}
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="댓글" aria-pressed={comments} onClick={() => setComments(!comments)} />}>
                <MessageSquare />
              </TooltipTrigger>
              <TooltipContent>댓글·제안</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="더 보기" />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60" finalFocus={false}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{count ? `${count.words.toLocaleString()}단어 · ${count.chars.toLocaleString()}자` : '문서'}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem checked={ui?.appearance.pageView === 'print'} onCheckedChange={() => act((e) => e.setPageView(ui?.appearance.pageView === 'print' ? 'continuous' : 'print'))}>
                    인쇄 모양으로 보기
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={!!ui?.suggesting} onCheckedChange={() => act((e) => e.setSuggesting(!ui?.suggesting))}>
                    제안 모드
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={!!ui?.spell} onCheckedChange={() => act((e) => e.setSpellChecker(ui?.spell ? null : spell))}>
                    맞춤법 검사
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={actions.open}>
                    <FolderOpen /> 가져오기…
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Download /> 내보내기
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-52">
                      {SAVE_FORMATS.map((f) => (
                        <DropdownMenuItem key={f.kind} onClick={() => actions.save(f.kind)}>
                          {f.label}
                          <span className="ml-auto text-xs text-muted-foreground">{f.ext}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onClick={() => ctl.handle && void openPdf(ctl.handle)}>
                    <Printer /> 인쇄 (PDF)
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setDialog('count')}>
                    <Type /> 단어 수
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDialog('keys')}>
                    <ScrollText /> 단축키
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDialog('about')}>이 예제에 대해</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <ContextBar ui={ui} act={act} onAlt={() => setDialog('alt')} />
        <main className="flex min-h-0 flex-1">
          <ContextMenu>
            <ContextMenuTrigger render={<div className="relative min-w-0 flex-1" />}>
              <QuireEditor editor={ctl} className="h-full" />
              {find && <FindCard key={find.key} editor={editor} replace={find.replace} onClose={() => setFind(null)} />}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56" finalFocus={false}>
              {s && (
                <>
                  <ContextMenuGroup>
                    <ContextMenuLabel className="text-destructive">{s.message ?? '맞춤법'}</ContextMenuLabel>
                    {s.suggestions.map((g) => (
                      <ContextMenuItem key={g} className="font-semibold" onClick={() => act(() => s.apply(g))}>
                        {g}
                      </ContextMenuItem>
                    ))}
                    <ContextMenuItem onClick={() => act(() => s.ignore())}>무시</ContextMenuItem>
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuGroup>
                <ContextMenuItem disabled={!ui?.hasSelection} onClick={actions.comment}>
                  댓글
                </ContextMenuItem>
                <ContextMenuItem onClick={actions.link}>링크…</ContextMenuItem>
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
            toast.success(`${f.name}을(를) 가져왔습니다`);
            if (Object.keys(dropped).length) {
              setReport({ name: f.name, dropped });
              setDialog('report');
            }
          } catch (err) {
            toast.error(`가져오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
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
        title="링크"
        label="주소"
        placeholder="https://"
        initial={ui?.marks.link ?? ''}
        okLabel="링크"
        removeLabel={ui?.marks.link ? '링크 지우기' : undefined}
        validate={(v) => (!ui?.hasSelection && !ui?.marks.link ? '먼저 링크를 걸 글을 고르세요.' : v && !safeLink(v) ? '걸 수 없는 주소입니다.' : null)}
        onSubmit={(v) => act((e) => e.setMark('link', v ? safeLink(v)! : undefined))}
        onClose={() => setDialog(null)}
      />
      <PromptDialog open={dialog === 'alt'} title="대체 텍스트" label="설명" initial={ui?.object?.alt ?? ''} onSubmit={(v) => act((e) => e.setObjectAttr('alt', v || undefined))} onClose={() => setDialog(null)} />
      <InfoDialog open={dialog === 'count'} title="단어 수" onClose={() => setDialog(null)}>
        <WordCountBody count={count} pages={ui?.pages ?? 0} />
      </InfoDialog>
      <InfoDialog open={dialog === 'keys'} title="단축키" wide onClose={() => setDialog(null)}>
        <p className="mb-2 text-muted-foreground">
          <kbd>/</kbd>를 치면 명령 메뉴, 글을 고르면 서식 막대가 뜹니다.
        </p>
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
          <p className="text-foreground">Quire 편집기를 Notion식 화면으로 꾸민 예제입니다 (Next.js + Tailwind + shadcn/ui).</p>
          <p>
            편집기는 <code>theme: &apos;minimal&apos;</code>, <code>pageView: &apos;continuous&apos;</code>로 쪽 경계 없이 그립니다. 쪽 나눔은 그대로라 PDF·인쇄는 쪽으로 나옵니다. <code>/</code> 메뉴는 편집기의{' '}
            <code>replaceRange</code>로 &quot;/찾을 말&quot;을 지우고 명령을 실행합니다.
          </p>
        </div>
      </InfoDialog>
    </div>
  );
}
