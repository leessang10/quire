/**
 * Quire 전체 기능 예제 (React + Vite + Tailwind): Word·Google Docs식 화면으로 편집기의 기능을 모두 보인다.
 * 화면 상태는 useUi(편집기 상태 알림마다 읽음), 명령은 act(편집기 API를 부르고 포커스를 돌려줌)로.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, MessageSquarePlus, PanelLeft, PanelRight, Share2 } from 'lucide-react';
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';
import type { Editor, WordCount } from '@quiredoc/core';
import { safeLink } from '@quiredoc/core';
import { highlightWordsPlugin, wordCountPlugin } from '@quiredoc/core';
import { fonts } from './lib/quire-demo';
import { DemoSpellChecker, OPEN_ACCEPT, documentTitle, emptyDoc, openAny, openPdf, sampleDocument, saveAny, tourDoc, SAMPLES, type SaveFormat } from './lib/quire-app';
import { useAct, useUi } from './lib/useUi';
import { AppMenus } from './components/AppMenus';
import { SizeList, Toolbar } from './components/Toolbar';
import { ContextBar } from './components/ContextBar';
import { FindPanel, OutlinePanel, ReviewPanel, StatusBar } from './components/Panels';
import { ContextMenu, NoticeDialog, PageSetupDialog, PromptDialog, ShortcutsDialog, WordCountDialog, type ContextMenuState } from './components/Dialogs';
import { Button } from './components/ui';

type DialogKind = 'page' | 'link' | 'alt' | 'count' | 'keys' | 'about' | 'report' | null;

export function App() {
  const [count, setCount] = useState<WordCount | null>(null);
  const [message, setMessage] = useState('');
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [panels, setPanels] = useState({ outline: true, review: true });
  const [composing, setComposing] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [report, setReport] = useState<{ name: string; dropped: Record<string, number> } | null>(null);
  const spell = useMemo(() => new DemoSpellChecker(), []);
  const ctl = useQuire({
    fonts,
    plugins: [wordCountPlugin((c) => setCount(c)), highlightWordsPlugin(['Quire'])],
    onFindRequest: (replace) => setFind({ replace }),
    onContextMenu: (e, s, items) => {
      setMenu({ x: e.clientX, y: e.clientY, spell: s, items });
      return true;
    },
  });
  const ui = useUi(ctl);
  const version = useEditorState(ctl, (s) => s.version);
  const act = useAct(ctl);
  const editor = (ctl.handle?.editor as Editor | undefined) ?? null;
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const title = ctl.handle ? documentTitle(ctl.handle) : 'Quire';

  // 콘솔에서 만져 보기
  useEffect(() => {
    (window as unknown as { quire: unknown }).quire = ctl;
  }, [ctl]);

  // 처음 문서: 기능 둘러보기
  useEffect(() => {
    void tourDoc().then(({ doc, assets }) => load(doc, assets));
  }, [ctl]);

  // 문서를 바꾸면 글자 수 플러그인이 다시 세게 한다 (편집할 때만 세므로)
  const load: typeof ctl.load = useCallback(
    (doc, assets) =>
      ctl.load(doc, assets).then(() => {
        ctl.run('wordCount.report');
        setTimeout(() => ctl.handle?.editor.focus(), 0);
      }),
    [ctl],
  );

  const flash = useCallback((m: string) => {
    setMessage(m);
    window.setTimeout(() => setMessage((cur) => (cur === m ? '' : cur)), 4000);
  }, []);

  const actions = {
    newDoc: () => void load(emptyDoc()).then(() => flash('새 문서')),
    tour: () => void tourDoc().then(({ doc, assets }) => load(doc, assets).then(() => flash('기능 둘러보기 문서를 열었습니다'))),
    sample: (id: string) =>
      void sampleDocument(id)
        .then((d) => load(d))
        .then(() => flash(`예제 문서: ${SAMPLES.find((s) => s.id === id)?.label}`))
        .catch((e: unknown) => flash(String(e))),
    open: () => fileInput.current?.click(),
    save: (kind: SaveFormat) => {
      const h = ctl.handle;
      if (!h) return;
      flash('저장하는 중…');
      void saveAny(h, kind).then(
        (n) => flash(`${kind.toUpperCase()}로 저장했습니다 (${(n / 1024).toFixed(1)} KB)`),
        (e: unknown) => flash(`저장하지 못했습니다: ${String(e)}`),
      );
    },
    print: () => ctl.handle && void openPdf(ctl.handle),
    find: (replace: boolean) => setFind({ replace }),
    link: () => setDialog('link'),
    image: () => imageInput.current?.click(),
    comment: () => {
      if (!ui?.hasSelection) return flash('먼저 댓글을 달 글을 고르세요');
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
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
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

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 pb-2 pt-2">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-sky-600 text-white">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[17px] text-slate-800">{title}</h1>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">전체 기능 예제</span>
            </div>
            <AppMenus ui={ui} act={act} a={actions} panels={panels} />
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" title="개요" onClick={() => actions.togglePanel('outline')} className={panels.outline ? 'bg-slate-100' : ''}>
              <PanelLeft className="size-4" />
            </Button>
            <Button variant="ghost" title="댓글·제안" onClick={() => actions.togglePanel('review')} className={panels.review ? 'bg-slate-100' : ''}>
              <PanelRight className="size-4" />
              {ui && ui.threads + ui.suggestions > 0 && <span className="rounded-full bg-sky-600 px-1.5 text-[10px] text-white">{ui.threads + ui.suggestions}</span>}
            </Button>
            <Button variant="ghost" title="댓글 달기 (Ctrl+Alt+M)" onClick={actions.comment}>
              <MessageSquarePlus className="size-4" />
            </Button>
            <Button variant="primary" onClick={() => actions.save('quire')} title="Quire 문서로 내려받기 (Ctrl+S)">
              <Share2 className="size-4" /> 저장
            </Button>
          </div>
        </div>
        <div className="mt-2">
          <Toolbar ui={ui} act={act} onLink={actions.link} onImage={actions.image} />
        </div>
      </header>
      <main className="flex min-h-0 flex-1">
        {panels.outline && <OutlinePanel editor={editor} version={version} />}
        <div className="relative min-w-0 flex-1 bg-slate-100">
          <QuireEditor editor={ctl} className="h-full" />
          <ContextBar ui={ui} act={act} onAlt={() => setDialog('alt')} />
          {find && <FindPanel key={String(find.replace)} editor={editor} replace={find.replace} onClose={() => setFind(null)} />}
        </div>
        {panels.review && <ReviewPanel editor={editor} version={version} composing={composing} onComposeDone={() => setComposing(false)} />}
      </main>
      <StatusBar ui={ui} count={count} message={message} input={editor ? (editor.inputKind === 'editcontext' ? 'EditContext' : 'textarea') : ''} engine={editor?.textEngine ?? ''} />

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
            flash(`${f.name}을(를) 열었습니다`);
            if (Object.keys(dropped).length) {
              setReport({ name: f.name, dropped });
              setDialog('report');
            }
          } catch (err) {
            flash(`열지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
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
      <SizeList />

      <PageSetupDialog editor={editor} open={dialog === 'page'} onClose={() => setDialog(null)} />
      <PromptDialog
        open={dialog === 'link'}
        title="링크"
        label="주소"
        placeholder="https://"
        initial={ui?.marks.link ?? ''}
        okLabel="걸기"
        removeLabel={ui?.marks.link ? '링크 지우기' : undefined}
        validate={(v) => (!ui?.hasSelection && !ui?.marks.link ? '먼저 링크를 걸 글을 고르세요.' : v && !safeLink(v) ? 'http, https, mailto, tel 주소만 걸 수 있습니다.' : null)}
        onSubmit={(v) => act((e) => e.setMark('link', v ? safeLink(v)! : undefined))}
        onClose={() => setDialog(null)}
      />
      <PromptDialog
        open={dialog === 'alt'}
        title="그림 대체 텍스트"
        label="화면 읽기 프로그램이 읽는 설명"
        initial={ui?.object?.alt ?? ''}
        onSubmit={(v) => act((e) => e.setObjectAttr('alt', v || undefined))}
        onClose={() => setDialog(null)}
      />
      <WordCountDialog open={dialog === 'count'} count={count} pages={ui?.pages ?? 0} onClose={() => setDialog(null)} />
      <ShortcutsDialog open={dialog === 'keys'} onClose={() => setDialog(null)} />
      <NoticeDialog open={dialog === 'report'} title="가져오며 버린 요소" onClose={() => setDialog(null)}>
        <p className="mb-2">{report?.name}에서 Quire가 담지 못하는 요소를 버렸습니다.</p>
        <ul className="list-disc pl-5">
          {Object.entries(report?.dropped ?? {}).map(([k, n]) => (
            <li key={k}>
              {k}: {n}개
            </li>
          ))}
        </ul>
      </NoticeDialog>
      <NoticeDialog open={dialog === 'about'} title="이 예제에 대해" onClose={() => setDialog(null)}>
        <div className="space-y-2 leading-6">
          <p>
            Quire 편집기의 기능을 모두 보여 주는 React 예제입니다. 화면은 <code>@quiredoc/react</code>의 <code>useQuire</code>·<code>QuireEditor</code>로 붙이고, 도구 막대·메뉴는
            편집기 API(<code>handle.editor</code>)를 부릅니다.
          </p>
          <p>문서는 캔버스에 직접 그려지고(한글 IME·스크린리더용 입력 층은 따로), HWPX·DOCX·Markdown·HTML·.quire를 열고 저장하며 PDF로 내보냅니다.</p>
          <p className="text-slate-500">실시간 협업·버전 이력은 동기화 서버가 필요해 이 예제에는 넣지 않았습니다 (저장소의 apps/playground/live.html).</p>
        </div>
      </NoticeDialog>
      <ContextMenu menu={menu} hasSelection={!!ui?.hasSelection} onClose={() => setMenu(null)} onComment={actions.comment} onLink={actions.link} />
    </div>
  );
}
