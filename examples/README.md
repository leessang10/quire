# Quire 예제 앱 (6-6)

저장소 **밖의 앱처럼** Quire를 쓰는 예제 여섯 개입니다. 워크스페이스에 들어 있지 않고, `npm pack`으로 만든 패키지(tarball)만 설치해 씁니다.
프레임워크 다섯 개에 CSS 방식을 하나씩 짝지어, 두 축(에디터 수명주기·전역 스타일 충돌)을 겹치지 않게 덮습니다 ([16 §8](../docs/design/16-release.md)).

| 예제 | 프레임워크 | CSS | 붙이는 방법 | 포트 |
|---|---|---|---|---|
| [vanilla](vanilla) | HTML + JS (Vite) | 순수 CSS | `createEditor` (@quire/sdk) | 5301 |
| [react-vite](react-vite) | React 19 + Vite | Tailwind 4 (preflight 켬) | `useQuire`·`QuireEditor`·`useEditorState` (@quire/react) | 5302 |
| [next](next) | Next.js 16 App Router | styled-components (서버 렌더링 스타일) | @quire/react + `next/dynamic` `ssr: false` | 5303 |
| [vue](vue) | Vue 3 + Vite | SCSS | `createEditor` + 작은 컴포저블 (공식 래퍼 없음) | 5304 |
| [svelte](svelte) | SvelteKit 3 + Svelte 5 | scoped 스타일 | `onMount`에서 `createEditor` (공식 래퍼 없음) | 5305 |
| [node](node) | Node (DOM 없음) | — | `@quire/convert`·`pdfFromQuire` CLI | — |

브라우저 예제 다섯 개는 기능이 같습니다: 굵게·기울임·밑줄(상태 반영), 실행 취소·다시 실행, 문단 스타일, 예제 플러그인(글자 수, 강조 낱말),
파일 열기(HWPX·DOCX·Markdown·HTML), 저장(HWPX·DOCX·Markdown·PDF). 공통 코드는 [`shared/quire-demo.ts`](shared/quire-demo.ts)를 각 예제에 복사해 씁니다.

## 실행

```bash
# 1) 저장소 루트에서 패키지를 빌드한다 (.build/packs/*.tgz)
node scripts/build-packages.mjs

# 2) 예제마다 설치 (postinstall이 글꼴 조각과 PDF용 WASM을 공개 폴더에 복사한다)
cd examples/react-vite
npm install
npm run dev          # http://localhost:5302

# Node 변환기
cd examples/node && npm install
node convert.mjs sample.md out/sample.pdf
node convert.mjs some.hwpx out/some.docx
```

## 앱이 할 일

- **글꼴**: `@quire/fonts`의 `fonts/`(조각 + `manifest.json`)를 공개 폴더 `/quire/fonts/`에 둔다. 문서에 나온 글자가 든 조각만 내려받는다.
- **PDF**: `harfbuzzjs/dist/harfbuzz-subset.wasm`을 `/quire/harfbuzz-subset.wasm`에 둔다 (PDF 글꼴 부분화).
- 그 밖의 WASM(HarfBuzz 셰이핑, Loro)은 패키지가 알아서 찾는다. 번들러 설정이 필요 없다 (Vite는 `optimizeDeps.exclude`에 `harfbuzzjs`·`loro-crdt`).
- 서버 렌더링 프레임워크(Next.js·SvelteKit)에서는 에디터를 브라우저에서만 만든다 (`ssr: false`, `onMount`).
