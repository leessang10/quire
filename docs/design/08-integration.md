# 08. 앱 통합 (React, Next.js, 서버)

- 상태: 구현됨 (5-8 SDK·React, 6-6 패키지·예제 앱). 0.2.0 패키지 구성(core + 모듈, 19)에 맞춰 고침 (2026-11-25)
- 처음부터 따라 하는 안내: 소개 페이지의 [단계별 가이드](https://quire-ten-omega.vercel.app/guide)

## 1. 요구사항

- R1. 코어는 특정 UI 프레임워크에 의존하지 않는다. React, Vue, Svelte, 바닐라 JS에서 쓸 수 있다.
- R2. React 앱에서 입력 1회가 React 리렌더를 일으키지 않는다 (16ms 목표 보호).
- R3. 툴바, 메뉴, 댓글 사이드바 같은 UI를 사용 앱이 자기 디자인 시스템으로 만들 수 있다.
- R4. Next.js(App Router)에서 SSR과 충돌 없이 동작하고, webpack·Turbopack 양쪽에서 번들링된다.
- R5. 레이아웃 엔진을 서버(Node)에서 실행해 PDF, 썸네일, 읽기 전용 보기를 만들 수 있다.

## 2. 패키지

0.2.0부터 `@quiredoc/core` 하나에 쓰는 모듈만 더한다 (19). 모듈은 core를 peer 의존으로 받아 앱에 core가 하나만 들어간다.

```sh
npm install @quiredoc/core @quiredoc/fonts      # 편집기, 저장·불러오기(.quire, 정본 JSON)
npm install @quiredoc/react                      # React: useQuire · QuireEditor · useEditorState
npm install @quiredoc/convert                    # HWPX · DOCX · Markdown · HTML
npm install @quiredoc/pdf harfbuzzjs             # PDF 내보내기
npm install @quiredoc/collab                     # 실시간 협업
```

| 패키지 | 의존 | 환경 |
|---|---|---|
| `@quiredoc/core` | 없음 (셰이핑은 HarfBuzz WASM) | 편집기(`createEditor`, `Editor`)는 브라우저. 문서 모델·조판·`.quire` 파일은 Worker·Node에서도 |
| `@quiredoc/react` | core, React 18+ | 브라우저 (클라이언트 컴포넌트) |
| `@quiredoc/convert` | core | 브라우저, Node. HTML·Markdown·DOCX·HWPX |
| `@quiredoc/pdf` | core | 브라우저, Node. `pdfFromQuire`는 DOM 없이 |
| `@quiredoc/collab` | core, Loro (WASM) | 브라우저, Worker, Node. 실시간 동기화·접속자·버전 기록 (`collab()` 플러그인) |
| `@quiredoc/fonts` | 없음 | 자산 패키지: 엔진 글꼴 조각과 `manifest.json` |

0.1.0의 `model`·`layout`·`shaping`·`editor`·`sdk`는 core에 합쳤고, `sync`는 정본·`.quire`(core)와 협업(collab)으로 나눴다. 가져오기 경로는 모두 `@quiredoc/core`이고, 하위 경로는 `@quiredoc/core/i18n/en`·`@quiredoc/core/tokens.scss`다 (CHANGELOG 0.2.0). 이 저장소 안의 `packages/model` 같은 폴더 이름은 개발 구조라 그대로다.

`@quiredoc/server`(예정이었던 것)는 두지 않았다. 서버에서 할 일은 `@quiredoc/convert`·`@quiredoc/pdf`를 Node에서 그대로 쓴다 (예제 `examples/node`). 빌드는 `scripts/build-packages.mjs`(ESM + 타입, 16 §10.1).

## 3. 에디터 공개 API (프레임워크 무관, `@quiredoc/core`)

```ts
import { createEditor } from '@quiredoc/core';

const editor = await createEditor({
  host: HTMLElement,
  doc?: QuireDoc,                 // 없으면 빈 문서
  plugins?: QuirePlugin[],
  fonts?: FontSource[],           // 엔진 글꼴: { name, manifest, bold? } (조각) 또는 { name, url | data }
  assets?: AssetStore,            // 이미지 자산 저장소 (MemoryAssets, HttpAssets(base, cache, token))
  // 그 밖의 Editor 옵션 (input, user, spellChecker, …)
});

editor.run('toggleBold');                       // 명령 실행 (내장 또는 '플러그인.명령')
editor.getState();                              // 불변 스냅샷 (EditorState)
editor.subscribe(listener): () => void;         // 상태 변경 알림
editor.caretRect(); editor.rangeRects(from, to);// UI 배치용 화면 좌표
editor.toJSON(): QuireDoc;
editor.load(doc, assets?);                      // 문서 바꾸기 (가져오기 결과)
editor.use(plugin): () => void;
editor.destroy();                               // 이벤트·자원 정리
editor.editor;                                  // 탈출구: Editor 자체 (넓은 API)
```

- 처음 설계의 `assets: { wasmUrl, workerUrl, fontBaseUrl }`는 두지 않았다 (6-5 §10.6). 글꼴은 `fonts`로, HarfBuzz 셰이핑 WASM은 패키지가 스스로 찾고, Loro(협업을 쓸 때만, `@quiredoc/collab`)는 base64 진입점이라 번들러 설정이 필요 없다. 앱이 둘 것은 글꼴 조각(`/quire/fonts/`)과 PDF 부분화용 `harfbuzz-subset.wasm`뿐이다 (`examples/README.md`).

원칙:
- **문서 상태는 에디터가 소유한다.** 앱은 문서를 state로 들고 있지 않는다. 저장이 필요하면 `subscribe` + 디바운스로 `toJSON()`을 받는다.
- `destroy()` 후 같은 host에 다시 `createEditor`를 해도 문제가 없어야 한다 (React StrictMode의 이중 마운트). 같은 플러그인 객체를 두 편집기가 써도 상태가 섞이지 않는다 (6-6).

## 4. React 래퍼

```tsx
'use client';
import { QuireEditor, useQuire, useEditorState } from '@quiredoc/react';
import { wordCountPlugin, type QuireDoc } from '@quiredoc/core';

export function ReportEditor({ doc }: { doc: QuireDoc }) {
  const editor = useQuire({ doc, fonts, plugins: [wordCountPlugin()] });
  const isBold = useEditorState(editor, (s) => !!s.marksAtCaret.bold);

  return (
    <>
      <button onClick={() => editor.run('toggleBold')} aria-pressed={isBold}>굵게</button>
      <QuireEditor editor={editor} className="h-full" />
    </>
  );
}
```

- `useEditorState(editor, selector)`는 `useSyncExternalStore` 기반이다. 선택한 값이 바뀔 때만 리렌더한다 (R2).
- 떠 있는 UI(슬래시 메뉴, 링크 편집 팝오버, 댓글 버튼)는 `editor.caretRect()` 좌표로 React 포털에 띄운다 (R3). 스크롤·줌 시 좌표 변경 이벤트를 구독한다.
- `useQuire`의 옵션 객체가 매 렌더마다 새로 만들어져도 에디터를 다시 만들지 않는다 (최초 1회만 사용, 변경이 필요한 값은 명령으로).
- `useQuire`는 에디터가 준비되기 전에도 컨트롤러를 돌려준다 (`run`은 준비 전이면 false, `editor.handle`은 null). 컴포넌트 밖에서 쓸 때는 `createController`.
- 예제: `examples/react-vite` (Tailwind), `examples/next` (styled-components).

## 5. Next.js

| 항목 | 방침 (6-6 예제 `examples/next`, Next.js 16에서 확인) |
|---|---|
| SSR | `@quiredoc/react`의 컴포넌트는 `'use client'`. 에디터는 브라우저에서만 만든다: `next/dynamic`으로 `ssr: false` |
| Turbopack | harfbuzzjs(Emscripten)가 Node에서만 부르는 `import("module")`을 브라우저 묶음에서도 찾는다 → `turbopack.resolveAlias: { module: { browser: './empty-module.js' } }`. webpack은 `resolve.fallback.module = false` |
| WASM | HarfBuzz 셰이핑 WASM은 패키지가 찾고, Loro(`@quiredoc/collab`을 쓸 때만)는 base64 진입점이라 따로 설정할 것이 없다. 협업을 쓰지 않으면 묶음에 Loro가 없다 |
| 글꼴 | 레이아웃용 글꼴은 `next/font`가 아니라 에디터가 직접 로드한다 (`fonts`의 manifest 주소, `public/quire/fonts/`). PDF 부분화는 `public/quire/harfbuzz-subset.wasm` |
| styled-components | 서버 렌더링 스타일 레지스트리(`useServerInsertedHTML`)와 `compiler.styledComponents` |
| 번들 크기 | 에디터 페이지에서만 지연 로드 (dynamic import) |
| 협업 서버 | 실시간 동기화는 오래 유지되는 WebSocket이 필요해 서버리스 함수에 맞지 않는다. 동기화 서버는 별도 프로세스로 둔다 (`apps/sync-server`) |

다른 프레임워크: Vue(`examples/vue`, 작은 컴포저블), SvelteKit(`examples/svelte`, `onMount`에서 동적 import), 바닐라(`examples/vanilla`). 공식 래퍼는 React만 둔다 (O-18).

## 6. 서버 실행 (R5)

레이아웃 엔진이 DOM에 의존하지 않으므로(02 R6) Node에서 같은 결과를 낸다.

| 기능 | 위치 예 | 상태 |
|---|---|---|
| PDF 내보내기 | Route Handler, CLI | **구현**: `pdfFromQuire(q, { fonts, subsetter })` (5-4, 6-6). 편집 화면과 같은 쪽 나눔 (6-3 골든) |
| 형식 변환 | Route Handler, CLI | **구현**: `@quiredoc/convert` (HTML·Markdown·DOCX·HWPX). 예제 `examples/node/convert.mjs` |
| 저장 검증 | Server Action | **구현**: `migrateQuire`·`documentFromQuire` (망가진 정본은 설명 있는 오류, 6-4) |
| 썸네일 | 저장 후 백그라운드 작업 | 나중 |
| 읽기 전용 SSR 보기 | Server Component | 나중 (O-19) |

서버에서 같은 쪽 나눔을 내려면 서버도 같은 글꼴 파일에 접근할 수 있어야 한다.

## 7. 열린 질문

- ~~O-18. Vue, Svelte 래퍼를 공식 제공할지.~~ 하지 않음 (6-5): 예제의 컴포저블·`onMount` 수십 줄이면 된다.
- O-19. SSR 읽기 전용 보기를 HTML(검색 엔진 친화)로 할지 SVG(정확한 재현)로 할지.
