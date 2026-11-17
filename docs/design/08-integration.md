# 08. 앱 통합 (React, Next.js, 서버)

- 상태: 초안

## 1. 요구사항

- R1. 코어는 특정 UI 프레임워크에 의존하지 않는다. React, Vue, Svelte, 바닐라 JS에서 쓸 수 있다.
- R2. React 앱에서 입력 1회가 React 리렌더를 일으키지 않는다 (16ms 목표 보호).
- R3. 툴바, 메뉴, 댓글 사이드바 같은 UI를 사용 앱이 자기 디자인 시스템으로 만들 수 있다.
- R4. Next.js(App Router)에서 SSR과 충돌 없이 동작하고, webpack·Turbopack 양쪽에서 번들링된다.
- R5. 레이아웃 엔진을 서버(Node)에서 실행해 PDF, 썸네일, 읽기 전용 보기를 만들 수 있다.

## 2. 패키지

| 패키지 | 의존 | 환경 |
|---|---|---|
| `@quire/model`, `text`, `layout`, `sync`, `commands` | 없음 | 브라우저, Worker, Node |
| `@quire/editor` | DOM | 브라우저. 순수 JS 클래스 |
| `@quire/react` | React 18+ | 브라우저 (클라이언트 컴포넌트) |
| `@quire/server` (예정) | Node | PDF·썸네일·검증 |

## 3. 에디터 공개 API (프레임워크 무관)

```ts
const editor = await createEditor({
  host: HTMLElement,
  doc: QuireDoc,
  plugins: Plugin[],
  assets: { wasmUrl?: string; workerUrl?: string; fontBaseUrl: string },
});

editor.run('toggleBold');                       // 명령 실행
editor.getState();                              // 불변 스냅샷
editor.subscribe(listener): () => void;         // 상태 변경 알림
editor.caretRect(); editor.rangeRects(range);   // UI 배치용 화면 좌표
editor.toJSON(): QuireDoc;
editor.destroy();                               // Worker, WASM, 이벤트 정리
```

원칙:
- **문서 상태는 에디터가 소유한다.** 앱은 문서를 state로 들고 있지 않는다. 저장이 필요하면 `subscribe` + 디바운스로 `toJSON()`을 받는다.
- `destroy()` 후 같은 host에 다시 `createEditor`를 해도 문제가 없어야 한다 (React StrictMode의 이중 마운트).

## 4. React 래퍼

```tsx
'use client';
import { QuireEditor, useQuire, useEditorState } from '@quire/react';

export function ReportEditor({ doc }: { doc: QuireDoc }) {
  const editor = useQuire({ doc, plugins: [tables(), comments()] });
  const isBold = useEditorState(editor, (s) => s.marksAtCaret.bold);

  return (
    <>
      <button onClick={() => editor?.run('toggleBold')} aria-pressed={isBold}>굵게</button>
      <QuireEditor editor={editor} className="h-full" />
    </>
  );
}
```

- `useEditorState(editor, selector)`는 `useSyncExternalStore` 기반이다. 선택한 값이 바뀔 때만 리렌더한다 (R2).
- 떠 있는 UI(슬래시 메뉴, 링크 편집 팝오버, 댓글 버튼)는 `editor.caretRect()` 좌표로 React 포털에 띄운다 (R3). 스크롤·줌 시 좌표 변경 이벤트를 구독한다.
- `useQuire`의 옵션 객체가 매 렌더마다 새로 만들어져도 에디터를 다시 만들지 않는다 (최초 1회만 사용, 변경이 필요한 값은 명령으로).

## 5. Next.js

| 항목 | 방침 |
|---|---|
| SSR | `@quire/react`의 컴포넌트는 `'use client'`. 서버에서 import만 해도 터지지 않게 모듈 최상위에서 DOM에 접근하지 않는다. 필요하면 `next/dynamic`으로 `ssr: false` |
| WASM·Worker | 라이브러리는 `new URL('./x.wasm', import.meta.url)` 패턴으로 참조해 번들러가 자산을 복사하게 한다. 번들러가 처리하지 못하는 환경을 위해 `assets.wasmUrl`, `assets.workerUrl`로 직접 지정 가능 |
| 글꼴 | 레이아웃용 글꼴은 `next/font`가 아니라 에디터가 직접 로드한다 (`assets.fontBaseUrl`, `public/` 또는 CDN) |
| 번들 크기 | 에디터 페이지에서만 지연 로드. 코어와 WASM은 별도 청크 |
| 협업 서버 | 실시간 동기화는 오래 유지되는 WebSocket이 필요해 서버리스 함수에 맞지 않는다. 동기화 서버는 별도 프로세스로 둔다 |

## 6. 서버 실행 (R5)

레이아웃 엔진이 DOM에 의존하지 않으므로(02 R6) Node에서 같은 결과를 낸다.

| 기능 | 위치 예 | 설명 |
|---|---|---|
| PDF 내보내기 | Route Handler | 편집 화면과 같은 쪽 나눔 |
| 썸네일 | 저장 후 백그라운드 작업 | 첫 쪽 PNG |
| 읽기 전용 SSR 보기 | Server Component | 레이아웃 트리를 정적 HTML/SVG로 그려 첫 화면을 빠르게 표시. 편집 모드 진입 시 캔버스 에디터로 교체 |
| 저장 검증 | Server Action | `document.json` 스키마 검증과 정규화 |

서버에서 같은 쪽 나눔을 내려면 서버도 같은 글꼴 파일에 접근할 수 있어야 한다.

## 7. 열린 질문

- O-18. Vue, Svelte 래퍼를 공식 제공할지.
- O-19. SSR 읽기 전용 보기를 HTML(검색 엔진 친화)로 할지 SVG(정확한 재현)로 할지.
