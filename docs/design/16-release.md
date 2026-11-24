# 16. 출시 준비와 안정화 (6단계)

- 상태: 진행 중 (6-1–6-6 끝남, 출시 준비 끝남 §10.8: 0.1.0을 태그로 낼 수 있다. 6-7 1차 실행: Chrome·EditContext 26개 통과, 한자 후보 Enter 문제를 고침. 스크린리더 청취·Edge·textarea 경로는 남음, §10.7)
- 관련: [06. 로드맵](06-roadmap.md) §3 성능 목표·§4 위험, [08. 앱 통합](08-integration.md), 10–15 각 결과 절의 "한계·남은 것"

## 1. 목표

1–5단계로 기능은 다 있다. 6단계는 그것을 **믿고 쓸 수 있게** 만든다. 새 기능을 더하지 않는다.

| 번호 | 목표 | 끝났다는 기준 |
|---|---|---|
| R1 | 회귀를 자동으로 잡는다 | 커밋마다 타입 검사·빠른 시험이 CI에서 돈다. 느린 시험은 매일 돈다 |
| R2 | 성능 목표(06 §3)를 숫자로 지킨다 | 다섯 지표를 실제 브라우저·실제 글꼴로 재는 벤치마크가 있고, 기준선과 비교해 나빠지면 실패한다 |
| R3 | 기기가 달라도 쪽 나눔이 같다 (06 §4 위험) | 기준 문서 세트의 레이아웃 지문이 Node·Chromium·Firefox에서 같다 |
| R4 | 남이 만든 파일과 링크에 안전하다 | 가져오기·열기가 악성·깨진 입력에서 멈추거나 터지지 않고, 위험한 링크·주소를 걸러 낸다 |
| R5 | 남은 일을 정리한다 | 10–15 결과 절의 한계·남은 것과 열린 질문을 분류해 고칠 것은 고치고, 남길 것은 이유를 적는다 |
| R6 | 패키지로 쓸 수 있다 | `@quiredoc/*`가 빌드되어(ESM + 타입) 저장소 밖 예제 앱에서 설치해 쓸 수 있다 |
| R7 | 실제 환경에서 확인한다 | 이 기기에서 할 수 있는 IME·스크린리더·브라우저 확인(06 §2 V1–V3 일부)을 체크리스트로 남긴다 |

## 2. 단계 계획

| 단계 | 내용 | 끝났다는 기준 |
|---|---|---|
| 6-1 | CI (R1): GitHub Actions에서 타입 검사·빠른 시험, 느린 시험 분리(매일), 시험 시간 표 | 워크플로가 푸시마다 돌고 빠른 묶음이 10분 안 |
| 6-2 | 성능 벤치마크 (R2): 플레이그라운드 벤치마크 모드, 다섯 지표, 기준선 파일, 비교 스크립트 | 1,000쪽 문서로 다섯 지표를 재고 기준선과 비교 |
| 6-3 | 레이아웃 골든 시험 (R3): 기준 문서 세트 × 실제 글꼴 지문, 브라우저 지문 비교 | Node와 브라우저 지문이 같음 |
| 6-4 | 보안·견고성 (R4): 링크·주소 정제, 크기·깊이 상한, 퍼즈 시험 | 가져오기 퍼즈에서 예외·멈춤 없음, 위험 링크 차단 |
| 6-5 | 남은 일 정리 (R5): 분류표, 고칠 것 고치기 | 분류표와 고친 목록 |
| 6-6 | 패키지 (R6): 빌드, exports, README, 저장소 밖 예제 | `npm pack` 결과를 예제 앱이 설치해 돈다 |
| 6-7 | 실제 환경 확인 (R7): 체크리스트 실행 기록 | 기록과 발견한 문제 |

순서: **6-6을 먼저** 한다. 저장소 밖 앱에서 써 보아야 6-2–6-5에서 고칠 것이 보인다. 6-2–6-5는 예제 앱을 본 뒤에, 6-1은 시험 시간 표가 나오면, 6-7은 마지막.

## 3. 6-1 CI

- 저장소에 CI가 없다. 전체 시험은 이 기기에서 약 70분이다 (CRDT 랜덤 수렴·큰 문서 시험).
- **빠른 묶음**: 타입 검사 + 시간이 짧은 시험 파일. 푸시·PR마다 돈다.
- **느린 묶음**: 나머지. 매일 한 번, 그리고 손으로 돌릴 수 있게.
- 나누는 기준은 파일별 소요 시간을 재서 정한다 (§3.1에 표). 느린 파일은 `*.slow.test.ts`로 이름을 바꾸지 않고 설정 목록(`vitest.slow.ts`)으로 고른다 (이름을 바꾸면 기록이 끊긴다).
- 워크플로: Node 22, `npm ci`, `npm run typecheck`, `vitest run`(빠른 묶음 설정). 캐시는 npm 캐시만.
- `spikes/crdt/results`는 시험이 쓰는 파일이라 CI에서 바뀌어도 무시한다.

### 3.1 시험 시간 (2026-11-20, 이 기기, 전체 실행)

전체: 파일 67개, 시험 968개(통과 966, 건너뜀 2), 실패 0. 파일별 시간 합 약 81분 중 한 파일이 76분.

| 파일 | 시간 | 묶음 |
|---|---|---|
| `spikes/crdt/src/random.test.ts` | 4,556초 | 느린 |
| `spikes/crdt/src/cleanup.test.ts` | 66초 | 느린 |
| `packages/sync/src/format-sync.test.ts` | 40초 | 빠른 |
| `packages/sync/src/sync.test.ts` | 35초 | 빠른 |
| `packages/sync/src/stories.test.ts` | 31초 | 빠른 |
| `packages/sync/src/tables.test.ts` | 23초 | 빠른 |
| `packages/model/src/doc.random.test.ts`, `segments.test.ts`, `spikes/crdt/src/blocks.test.ts` | 각 약 19초 | 빠른 |
| 나머지 58개 | 합 약 50초 | 빠른 |

- 기준: 파일 하나가 60초를 넘으면 느린 묶음 (`vitest.slow.ts`의 `SLOW_TESTS`).
- 빠른 묶음: 이 기기에서 병렬로 27초 (파일 65개, 시험 955개). 목표(10분)에 넉넉하다.

## 4. 6-2 성능 벤치마크

- 06 §3의 다섯 지표: 입력 지연 p95, 첫 화면, 전체 조판, 스크롤 fps, 메모리.
- 플레이그라운드 `bench.html`: 1,000쪽 문서를 열고 각 지표를 재어 `window.benchResult`(JSON)에 둔다. 입력은 숨긴 textarea에 `beforeinput`을 넣어 실제 입력 경로로 잰다.
- `scripts/bench.mjs`: 개발 서버를 띄우고 헤드리스 Chrome(없으면 Edge)을 DevTools 프로토콜로 몰아 여러 번 돌린 뒤, 가운뎃값을 `bench/baseline.json`·06 §3 목표와 비교한다. 브라우저 자동화 패키지를 더하지 않는다 (Node 22의 내장 WebSocket).
- 실패 기준: 목표를 넘거나, 기준선보다 20% 넘게 그리고 지표별 절대 여유보다 많이 나쁨.
- 창이 보이지 않는 브라우저 탭(백그라운드)에서는 rAF가 멈춰 잴 수 없다. 그래서 헤드리스로 돈다.

## 5. 6-3 레이아웃 골든 시험

- 기준 문서 세트(12 §13, `fixtures/docs`)를 저장소 글꼴로 셰이핑·조판한 쪽 나눔과 줄 나눔의 지문.
- Node 시험(`reference.test.ts`)이 지문을 기대값과 비교한다. 같은 지문을 브라우저에서 두 경로로 내어 같은지 본다:
  실제 편집기(조각 글꼴, 백그라운드 조판)와 통째 글꼴로 Node와 똑같이 조판한 것. 지문 계산은 `@quiredoc/editor` `reference.ts` 하나를 함께 쓴다.
- `apps/playground/golden.html` + `scripts/golden.mjs` (6-2의 헤드리스 도우미 `scripts/headless.mjs`). Firefox는 이 기기에 없다.

## 6. 6-4 보안·견고성

- 링크: `javascript:`·`data:`·`vbscript:` 등 위험한 스킴을 가져오기·붙여넣기·내보내기(HTML·PDF·DOCX·HWPX)에서 막는다 (허용: http, https, mailto, tel, 문서 안 #, 상대 경로). 모델에는 그대로 둔다 (§10.5).
- 크기 상한: zip 항목 수·풀린 크기(zip 폭탄), XML 깊이, HTML·Markdown 중첩, 표 칸 합치기.
- 퍼즈: 정상 파일을 바이트·구조 단위로 무작위로 망가뜨려 가져오기·`.quire` 열기가 예외(설명 있는 오류는 괜찮다)나 멈춤 없이 끝나는지.

## 7. 6-5 남은 일

- 대상: 12·14·15의 결과 절 "한계·다음"(104줄, 다음 단계 안내를 빼면 약 80개)과 열린 질문 중 미해결, 그리고 6단계에서 새로 나온 한계.
- 분류: 고침(6단계), 나중(이유), 하지 않음(이유). 이 문서 §10.6에 표.

## 8. 6-6 패키지

- 지금은 모든 패키지가 `exports: ./src/index.ts`(소스 그대로)다. 빌드해 `dist`(ESM + .d.ts)를 내고, 개발은 계속 소스로 한다.
- WASM·글꼴 자산의 위치를 앱이 정하게 한다 (08 §3 `assets`).
- 예제는 두 축을 덮는다: **에디터 수명주기**(프레임워크: 바닐라, React, Next.js, Vue, SvelteKit)와 **전역 스타일 충돌**(CSS: 순수 CSS, Tailwind preflight, styled-components, SCSS, scoped). 조합을 다 만들지 않고 프레임워크마다 CSS 하나씩, 그리고 DOM 없는 Node 변환기 하나 — 모두 여섯.

## 9. 6-7 실제 환경

- 이 기기: Windows 11, Chrome·Edge(·Firefox가 있으면), 한글 IME. 플레이그라운드 `/checklist.html`을 돌려 기록한다.
- 이 기기에 없는 환경(macOS·iOS·Android, VoiceOver)은 할 수 없다고 적는다.
- 준비됨 (실행은 나중): 체크리스트에 V4 "새 입력 자리"를 더했다 — 표 셀 조합, 셀 안 조합 중 Enter, 셀 안 한자 후보 창, 각주·머리말 조합, 제안 모드 조합. V3에는 표 읽기. 시나리오가 처음 상태를 만들고(`setup`) 그 스토리 글로 판정한다(`read`). 숨긴 textarea 경로로 다섯 시나리오의 준비·판정이 맞음을 확인했다. 이 기기의 스크린리더는 Windows 내레이터뿐이다 (NVDA 없음).

## 10. 결과

### 10.1 6-6 패키지와 예제 앱

**빌드** (`scripts/build-packages.mjs`, 결과는 `.build/`, 저장소에는 넣지 않음)

- 순서: model → layout → shaping → editor → sync → convert → pdf → sdk → react. 판은 모두 0.1.0.
- tsc로 선언(.d.ts)을 한 번에 내고, 패키지마다 Vite 라이브러리 모드로 ESM 하나(`dist/index.js`). 의존성은 모두 외부로 둔다.
- 배포용 `package.json`을 새로 쓴다: `exports`의 `types`·`import`, 내부 의존성은 0.1.0으로 고정.
- `loro-crdt` 가져오기를 `loro-crdt/base64`로 바꾼다: WASM을 base64로 품은 진입점이라 앱 번들러에 WASM 설정이 필요 없다. 별칭(alias)으로는 안 된다 — 외부 처리가 별칭보다 먼저라서 빌드 결과의 문자열을 바꾼다.
- `@quiredoc/fonts`: 플레이그라운드의 글꼴 조각·manifest·라이선스를 묶은 자산 패키지.
- `npm pack`으로 `.build/packs/*.tgz`.

**예제** (`examples/`, 워크스페이스 밖, tarball만 설치)

| 예제 | 프레임워크 | CSS | 붙이는 방법 | 포트 |
|---|---|---|---|---|
| vanilla | HTML + JS (Vite 8) | 순수 CSS | `createEditor` | 5301 |
| react-vite | React 19 + Vite 8 | Tailwind 4 (preflight) | `useQuire`·`QuireEditor`·`useEditorState`, StrictMode | 5302 |
| next | Next.js 16 App Router (Turbopack) | styled-components (SSR 레지스트리) | @quiredoc/react + `next/dynamic` `ssr: false` | 5303 |
| vue | Vue 3 + Vite 8 | SCSS | `createEditor` + 컴포저블 | 5304 |
| svelte | SvelteKit 3 + Svelte 5 | scoped | `onMount`에서 동적 `import('@quiredoc/sdk')` | 5305 |
| node | Node 22 | — | `@quiredoc/convert` + `pdfFromQuire` CLI | — |

브라우저 다섯 개 모두: 서식 버튼 상태 반영, 실행 취소·다시 실행, 문단 스타일, 예제 플러그인(글자 수·강조 낱말), 열기(HWPX·DOCX·MD·HTML), 저장(HWPX·DOCX·MD·PDF)을 확인했다. Node: MD → PDF·HWPX·DOCX, HWPX → MD, DOCX → PDF.

**써 보고 고친 것** (라이브러리)

| 발견 | 고침 |
|---|---|
| SDK로 파일을 열 방법이 없었다 | `createEditor().load(doc, assets)`, React 컨트롤러 `load` |
| PDF가 DOM에 묶여 있었다 (편집기 `printSource()`만) | `pdfFromQuire(q, {fonts, subsetter, asset})`: DOM 없이 조판해 PDF. `@quiredoc/pdf`가 `@quiredoc/sync`에 의존 |
| 글자 수 플러그인이 `createEditor`가 값을 돌려주기 전에 콜백을 불렀다 (앱 쪽 TDZ 오류) | 첫 알림을 다음 틱으로 |
| 같은 플러그인 객체를 편집기 둘이 쓰면(StrictMode 이중 마운트) 앞 편집기의 늦은 정리가 뒤 편집기 상태를 지웠다 | 상태를 붙일 때마다(`init`)·컨텍스트마다(WeakMap) 따로 |
| Markdown 내보내기에서 이웃한 목록(글머리 → 번호)이 한 목록으로 붙었다 | 최상위 목록 ID가 바뀌면 빈 줄 |

**앱이 알아야 할 것** (`examples/README.md`에 적음)

- 글꼴 조각을 `/quire/fonts/`에, PDF 부분화용 `harfbuzz-subset.wasm`을 `/quire/`에 둔다 (예제는 postinstall 스크립트로 복사).
- Vite: `optimizeDeps.exclude: ['harfbuzzjs', 'loro-crdt']`.
- Next.js(Turbopack): harfbuzzjs의 Emscripten 코드가 Node에서만 부르는 `import("module")`을 브라우저 묶음에서도 찾는다 → `turbopack.resolveAlias`로 빈 모듈. webpack은 `resolve.fallback.module = false`.
- SvelteKit 3: `svelte.config.js` 대신 플러그인 옵션, `$lib` 대신 package.json `imports`(`#lib/*`).
- 서버 렌더링 프레임워크에서는 에디터를 브라우저에서만 만든다.

**의존성 판**: 처음 고른 판의 알려진 취약점 때문에 Vite 6 → 8, Next 15 → 16, SvelteKit 2 → 3(TypeScript 6, adapter-static 4, vite-plugin-svelte 7), happy-dom 15 → 21로 올렸다. 예제 여섯 개 모두 `npm audit` 0건으로 설치된다.

**한계·남은 것**

- npm 레지스트리 배포는 하지 않았다 (이름·판 정책은 출시 때). 예제는 `file:` tarball로 설치한다.
- Vue·Svelte용 공식 래퍼는 없다 (예제의 컴포저블·onMount 수준이면 충분해 보인다). 필요해지면 `@quiredoc/vue` 등.
- Node에서 PDF를 만들려면 앱이 글꼴 바이트를 manifest에서 모아 넘겨야 한다. 편의 함수(`fontsFromManifest`)는 6-5 후보.

**전체 기능 예제 (6단계 뒤 더함)**: 기본 앱은 붙이는 법만 보여 주므로, Word·Google Docs식 화면으로 기능을 모두 보이는 앱 둘을 더했다 — `examples/react-full`(React + Vite + Tailwind, 직접 만든 컴포넌트)과 `examples/next-shadcn`(Next.js 16 + Tailwind + shadcn/ui Base UI판). 메뉴 막대·도구 막대·상황별 줄(표·그림·머리말·각주)·개요·댓글과 제안 창·찾기·쪽 설정·오른쪽 클릭·상태 줄. UI가 아닌 공통 코드는 `examples/shared/quire-app.ts`. 브라우저에서 확인: 예제 문서 6개가 기준 기대값과 같은 쪽 수로 열림, 저장 6형식과 `.quire` 왕복(글·댓글·제안 그대로), 표·머리말·각주·그림 도구 줄, 찾기, 2단 쪽 설정, 제안 모드, 댓글, 맞춤법. 두 앱 모두 프로덕션 빌드와 `npm audit` 0건.

- 찾아 고친 편집기 버그: `printSource().title`이 본문이 아니라 편집 중인 스토리의 첫 문단을 읽어, 캐럿이 표 셀·머리말에 있을 때 저장한 PDF·HWPX·DOCX의 제목이 비었다 → 본문 첫 문단.
- 찾아 고친 그림 크기 조절 (사용자 보고): 끄는 동안 미리보기가 글자처럼 놓인 그림은 아래·왼쪽 변, 떠 있는 그림은 위·왼쪽 변을 고정해 아래·왼쪽·위 손잡이가 커서와 반대로 움직였다. 모서리는 가로 움직임만 보아 세로로 끌면 반응이 없었다 → 끄는 손잡이 반대쪽 변을 고정하고(떠 있는 그림은 놓을 때 자리도 그만큼 옮김), 모서리는 가로·세로 중 더 크게 바뀐 쪽 비율로. 손잡이 8개 중 5가지 경우를 브라우저에서 끌어 확인했다.
- shadcn CLI 4.22: Base UI판을 기본으로 깔고, `cn`을 npm의 제3자 패키지 `cn`에서 가져오게 썼다 (CLI 패키지의 의존성). 표준 `clsx` + `tailwind-merge`로 고치고 CLI 패키지를 의존성에서 뺐다 (감사 경고 4건도 CLI의 것이었다).

### 10.2 6-1 CI

- `.github/workflows/ci.yml`: 푸시(main)·PR마다 `fast` 작업(`npm ci` → `npm run typecheck` → `vitest.fast.config.ts`). 매일 03:00(KST)과 손으로 돌릴 때 `slow` 작업(`vitest.slow.config.ts`, 제한 180분).
- `vitest.slow.ts`: 느린 파일 목록. 빠른 설정은 이 목록을 빼고, 느린 설정은 이 목록만 돈다. 기본 `vitest run`(전체)은 그대로다.
- 시간 표는 §3.1.
- **첫 CI 실행이 잡은 버그**: 보기 역할 클라이언트가 붙을 때마다 서버에 거부당하고 되돌림·재연결을 되풀이했다 (100ms에 70번). 클라이언트는 SYNC 뒤 서버에 없는 변경을 바이트 길이(`mine.length > 0`)로 판단했는데, Loro는 변경이 없어도 머리만 있는 빈 업데이트를 돌려준다. 보기 역할은 어떤 업데이트든 거부한다. 이 기기에서는 타이밍상 시험이 통과했고, Ubuntu 러너에서 드러났다. 고침: 클라이언트는 버전 비교로 앞설 때만 보내고(`ws.ts`), 서버는 보기·댓글 역할의 새 연산 없는 업데이트를 거부하지 않고 버린다(`decodeImportBlobMeta`). 시험이 붙기만 한 뒤 거부 0을 확인한다.

**한계**

- Ubuntu 러너에는 Windows 글꼴(맑은 고딕·Calibri)이 없어서 셰이핑 시험 둘(`packages/shaping/src/shaper.test.ts`, `spikes/shaping/src/shaping.test.ts`)은 CI에서 건너뛴다. 저장소 글꼴(Noto Sans KR·Pretendard)로 돌리는 시험은 그대로 돈다. 이 둘은 옮기지 않기로 했다 (6-3): 맑은 고딕의 옛 kern 표(GPOS 없음), Calibri 합자, 옛한글 조합처럼 그 글꼴의 성질을 보는 시험이라 저장소 글꼴로 바꾸면 그 경로를 덜 본다. 저장소 글꼴 경로는 기준 문서 시험과 골든 비교가 CI에서 본다.
- Word·한글로 다시 저장한 파일을 쓰는 시험(`QUIRE_WORD_RESAVED`·`QUIRE_HWP_RESAVED`)은 환경 변수가 없으면 건너뛴다. 그 파일은 이 기기에서만 만든다.
- 브라우저 시험(6-2 벤치마크 등)은 CI에서 돌리지 않는다.
- 첫 CI 실행 시간은 이 PR에서 확인한다.

### 10.3 6-2 성능 벤치마크

**재는 법** (`apps/playground/bench.html`, `src/bench.ts`)

| 지표 | 재는 법 |
|---|---|
| 입력 p50·p95 | 문서 가운데에서 300번 입력 (40번마다 Enter). 한 번 = `beforeinput` 처리(동기 조판) + 다음 프레임의 그리기. 프레임을 기다리는 시간(vsync)은 뺀다. 프레임 끝까지의 벽시계 값은 `inputWallP95Ms`(참고) |
| 첫 화면 | `new Editor`부터 엔진 글꼴 준비 뒤 첫 그리기까지. 글꼴 전 시스템 글꼴 화면은 `firstFrameMs` |
| 전체 조판 | `new Editor`부터 백그라운드 쪽 조립이 끝날 때까지 (메인 스레드, 유휴 조각) |
| 스크롤 | 프레임마다 화면 높이의 40%씩 3초 동안 스크롤, 프레임 수와 간격 p95 |
| 메모리 | 끝난 뒤 GC 한 번, JS 힙 + DOM + ArrayBuffer·WASM (`Runtime.getHeapUsage`). 캔버스(GPU) 메모리는 빠진다 |

**기준선** (이 기기, Chrome 157 헤드리스, 1,001쪽·문단 10,007개, 3번의 가운뎃값)

| 지표 | 값 | 06 §3 목표 |
|---|---|---|
| 입력 p95 | 3.2 ms (p50 1.9) | 16 ms |
| 첫 화면 | 295 ms (첫 프레임 84 ms) | 1초 |
| 전체 조판 | 817 ms | 10초 |
| 스크롤 | 75 fps (화면 주사율), 프레임 p95 13.4 ms | 60 fps |
| 메모리 | 52 MB | 500 MB |

다섯 지표 모두 목표 안이다. 실행마다 흔들림: 첫 화면 270–545 ms, 전체 조판 790–1,460 ms (그래서 3번의 가운뎃값과 절대 여유).

- 처음에는 한 탭에서 연달아 돌려 앞 실행의 힙이 남았다(74 → 106 → 185 MB). 실행마다 새 탭을 열고 GC 뒤에 잰다.
- `performance.memory`는 JS 객체만 세어 20 MB로 나왔다. 글꼴 조각·HarfBuzz WASM의 ArrayBuffer(약 32 MB)를 더한다.
- CI: 매일 작업(`bench`)에서 Ubuntu 러너로 돌리되 기준선 없이 목표만 본다 (`--targets-only`, 기기가 다름). 결과 JSON을 아티팩트로 남긴다.
- 첫 CI 실행 (GitHub ubuntu-latest, Chrome 157 헤드리스): 입력 p95 2.9 ms, 첫 화면 673 ms (첫 프레임 295 ms), 전체 조판 1,230 ms, 60 fps, 52 MB — 모두 목표 안. 쪽 수도 1,001쪽으로 같다.

**한계**: 전체 조판은 Worker가 아니라 메인 스레드 유휴 조각이다 (06 §3 "Worker 사용" 조건과 다르지만 목표 안). 스크롤 fps는 화면 주사율에 묶인다. 실제 키보드·IME 지연은 6-7에서 본다.

### 10.4 6-3 레이아웃 골든

**구성**

- `@quiredoc/editor` `reference.ts`: `composeReference`(편집기와 같은 설정으로 처음부터 조판)와 `summarizeLayout`(쪽 수·용지·쪽마다 첫 줄·줄 위치 FNV-1a 지문·머리말·각주·표 행 조각). Node 시험의 코드를 옮겼다.
- `Editor.layoutSummary()`: 실제 편집기 레이아웃의 같은 지문 (백그라운드 조판이 끝나기 전이면 null).
- `golden.html`: 문서마다 편집기를 열고(조각 글꼴, 늦게 받는 조각이 다시 조판할 때까지 지문이 세 번 연속 같을 때까지 기다림) 지문을 내고, 통째 글꼴로도 조판해 둘 다 `*.expected.json`과 비교한다.
- `scripts/golden.mjs` (`npm run golden`): 찾은 브라우저마다 헤드리스로 돌린다. 하나라도 다르면 종료 코드 1.
- CI 빠른 작업에 넣었다 (글꼴 조각 빌드 1초 미만 + 골든 수 초). Ubuntu Chrome에서 같으면 운영체제가 달라도 쪽 나눔이 같다.

**결과**: 기준 문서 6개(forms 3쪽, manual 8쪽, newsletter 2쪽, paper 4쪽, report 2쪽, schedule 9쪽)가 Chrome 157·Edge(헤드리스, Windows)에서 편집기 경로·통째 글꼴 경로 모두 Node 기대값과 같다. CI(GitHub ubuntu-latest, Chrome 157 헤드리스)에서도 같다: 기대값은 Windows Node에서 만든 것이라 운영체제가 달라도 쪽 나눔이 같음을 확인했다.

**찾아 고친 버그**: 머리말·꼬리말이 있는 문서를 처음부터 편집기에 주면(`new Editor({ document })`, SDK `createEditor({ doc })`) 생성 중 예외가 났다. `resetLayouts()`가 쪽 조판기를 먼저 만들었는데, 조판기는 만들 때 첫 프레임(구역의 머리말 높이)을 재고, 서식기에 측정기를 넣는 `fmt.reset`은 그다음 줄이었다. 순서를 바꿨다. 플레이그라운드는 열린 편집기에 `setDocument`로 넣어서 이 경로를 타지 않았다.

**도우미 고친 것**: Edge는 stderr에 DevTools 주소를 찍지 않아 프로필의 `DevToolsActivePort` 파일로 포트를 읽는다. 브라우저가 끝나기를 기다린 뒤 임시 프로필을 지운다.

**한계**: Firefox·Safari(다른 JS 엔진·다른 캔버스)는 이 기기에 없어 보지 못했다. 골든은 지문(줄 위치)까지이고 픽셀 비교는 하지 않는다.

### 10.5 6-4 보안·견고성

**링크** (`@quiredoc/model` `safeLink`)

- 허용: http, https, mailto, tel, 스킴 없는 주소(#, 상대 경로). 브라우저처럼 앞뒤 공백·제어 문자와 스킴 안의 탭·줄바꿈을 버리고 스킴을 읽는다 (`" java	script:"`도 막힘).
- 문서 모델에는 받은 값을 그대로 둔다: 동기화 피어마다 같아야 하고, 편집기는 링크를 열지 않는다. 대신 경계에서 막는다:
  - 가져오기(HTML·Markdown·DOCX·HWPX): 끝에서 빼고 보고서에 `위험한 링크: n`. HTML 붙여넣기도 글만 붙인다.
  - 내보내기(HTML·Markdown·DOCX·HWPX): 시작에서 뺀 사본으로 (부른 쪽 정본은 그대로). PDF는 링크 주석을 만들지 않는다. 클립보드 HTML에도 쓰지 않는다.

**크기·깊이 상한**

| 곳 | 상한 | 넘으면 |
|---|---|---|
| zip 항목 수 | 20,000 | `zip: too many entries` |
| zip 항목 하나 (풀린 크기) | 256 MiB | `zip: … is too large` (풀기 전에) |
| zip 전체 (풀린 크기) | 512 MiB | `zip: contents too large` |
| deflate 풀기 | 선언한 크기까지만 | 더 풀리면 멈추고 `damaged` (압축 폭탄·거짓 크기) |
| XML 요소 중첩 | 256 | `xml: elements nested too deeply` |
| HTML 요소 중첩 | 256 | 더 들어가지 않고 그 자리에 붙인다 (HTML은 너그럽게) |
| Markdown 인라인 중첩 | 32 | 그 안은 글로 |
| 표 칸 합치기·열 수 (HTML·DOCX·HWPX) | colspan 1000, rowspan은 남은 행 | 묶는다 |

- zip을 읽다 난 범위 밖 읽기 같은 오류는 `zip: damaged file (…)`로, `.quire`의 JSON 문법 오류는 `.quire: document.json is not valid JSON`으로, 망가진 정본에서 난 내부 TypeError는 `document.json: malformed document (…)`로 알린다.

**시험** (`packages/convert/src/security.test.ts`, 빠른 묶음): 링크 정제(위험 9종·안전 7종), 내보내기 4종에 위험 링크가 없음, 가져오기가 빼고 보고, 압축 폭탄(4 MiB 0을 1 KiB로 속임), 상한, 잘린 zip, 10만 단계 중첩(XML·HTML·Markdown 5가지), 퍼즈:

| 입력 | 경우 | 성공 / 설명 있는 오류 |
|---|---|---|
| DOCX (바이트 75 + 안쪽 XML 75) | 150 | 75 / 75 |
| HWPX (같음) | 150 | 75 / 75 |
| .quire (같음, 해시 검사가 대부분 걸러 냄) | 150 | 23 / 127 |
| 정본 JSON 구조 (값 타입 바꾸기·키 지우기·복제) | 300 | 151 / 149 |
| HTML·Markdown 글 | 150씩 | 모두 성공 |

모든 경우가 5초 안에 끝나고, 성공한 가져오기는 편집 문서로 열린다. PDF: 위험한 링크는 링크 주석이 없다 (`headless.test.ts`).

**퍼즈가 찾은 것**: 망가진 HTML의 `colspan="98765432"`가 칸 표시를 수억 개 만들어 11초 뒤 `Set` 크기 한도로 터졌다 → HTML·DOCX·HWPX 모두 칸 합치기를 묶는다. 정본 JSON의 잘못된 모양은 TypeError가 새어 나왔다 → 설명 있는 오류로.

**한계**: 이미지 바이트는 해독하지 않고(브라우저가 그림으로 그릴 때 해독) 크기만 본다. 문단 수 상한은 두지 않았다 (zip·글 크기 상한이 먼저 걸린다). 퍼즈는 시드 고정의 수백 경우로, 오래 도는 퍼저(커버리지 유도)는 아니다.

### 10.6 6-5 남은 일 정리

**6-5에서 고친 것**

| 무엇 | 고침 |
|---|---|
| 권한이 걸린 방의 이미지 (14 §17 "자산 GET에 토큰을 싣지 않는다") | `HttpAssets(base, cacheName, token)`이 내려받기·올리기에 `?token=`을 싣는다. 그동안 보기·편집 모두 403이었다 (올리기도). 플레이그라운드 `live`가 넘긴다 |
| 권한이 걸린 방의 자산이 `cache-control: public` | `private` (프록시·CDN 같은 공유 캐시에 남지 않게). 위를 고치다 찾았다 |
| CI 액션의 Node 20 지원 종료 경고 (6-1) | `checkout`·`setup-node`·`upload-artifact` v7 (Node 24) |

6단계 앞 단계(6-1–6-4)에서 이미 고친 것: 보기 역할 재동기화 반복(6-1), 머리말 있는 문서를 처음부터 열면 예외(6-3), 위험한 링크·압축 폭탄·깊은 중첩·칸 합치기·정본 내부 오류(6-4), SDK `load`, DOM 없는 PDF, 예제 플러그인 상태, Markdown 이웃 목록(6-6).

**나중 (이유)** — 기능 확장이거나, 측정·정책 결정이 먼저인 것

| 영역 | 항목 | 이유 |
|---|---|---|
| 조판 (12) | 표가 단·쪽보다 넓을 때 줄여 그리기 (지금은 넘친다) | 줄일지 자를지 Word·한글 동작을 맞춰 정해야 하고, 쪽 나눔이 바뀐다 (기준 문서 기대값 갱신 필요) |
| | 큰 표 증분 조판 (3,000행 셀 입력 33 ms) | 1,000행까지 목표 안. 6-2 벤치에 큰 표 문서를 넣어 잰 뒤 |
| | 다단: 띠 위 프레임 자르기, 문서 끝 균형 설정, 단마다 다른 폭, 균형 띠의 각주 위치 | 가져온 문서에서 드문 고급 기능 |
| | 표 쪽 분할: 덮인 셀 글이 있는 행·여러 행 병합 셀 쪼개기, 세로 정렬과 쪼개기, 넘친 행 진단 | 위와 같음 |
| | 금칙 목록 설정, 괄호·따옴표 반각, 문단 단위 최적 줄바꿈 (O-31) | 한글 조판 고급 설정. 기본값으로 충분하다는 사용자 확인이 먼저 |
| | 각주: 번호 눌러 참조로, 셀·머리말 안 각주, 각주 글자 크기 | 각주 스타일과 함께 |
| | 머리말: 안 표·떠 있는 개체, 본문 필드 (O-29), 원격 캐럿·찾기 결과를 같은 머리말의 모든 쪽에 | 머리말 범위를 쪽마다 푸는 일 하나로 묶어서 |
| | 문서 설정 `widowControl` | 가져온 문서가 끄는 경우가 나오면 |
| | 백그라운드 조립 중 추정 쪽 수 흐리게 | 화면 다듬기 |
| 접근성 (12·14·15) | 각주·머리말·주석(`<mark>`, `aria-describedby`)·찾기 알림·맞춤법 `aria-invalid` 미러, 댓글 창 키보드 이동 | 6-7 스크린리더 확인에서 우선순위를 정한다 (실제 읽기를 들어 보고) |
| 협업 (14) | 주석 수천 개의 증분 범위 | 벤치에서 재고 나서 (지금 주석 수백 개는 문제없음) |
| | 재기반 때 주석 옮기기 | 긴 오프라인 편집과 서버 압축이 겹칠 때만. 판 옮기기 설계(09 §9)를 넓혀야 한다 |
| | 제안: 개체 속성·스타일·표 구조 제안, 삭제 제안 위에 바꿔 쓴 글의 위치(Word는 뒤), 삭제된 ¶·개체 표시, 서식 제안 이름 표시 | 제안 모드 2차 |
| | 버전: 스냅샷 전체 내려받기(1만 쪽 수 MB), 이동·표 구조 비교, 복원을 실행 취소 한 단계로, 판을 건너는 비교, 앞 판 파일 정리 | 서버 비교(O-34)와 보존 정책(O-15) 결정 뒤 |
| | 댓글 역할이 지워진 커서의 다른 주석을 다시 쓰면 거부·재동기화 | 드묾. 6-1의 빈 업데이트 수정으로 반복은 없어졌다 |
| 생산성 (15) | 찾기: 스크롤 막대 눈금, 결과 미러 알림 | 화면 다듬기 |
| | 맞춤법: 셀·각주·머리말 유휴 검사, 입력 중 미러 밑줄, 한국어 기본 검사기 (O-36) | O-36은 사전 라이선스(MPL·GPL·LGPL) 결정이 먼저 |
| | PDF: 이모지(엔진 글꼴에 없는 글자, `missingGlyphs`로 셈), Worker·쪽 단위 스트리밍 (1,000쪽 3 s), 서버 내보내기 끝점 | 이모지는 컬러 글꼴(COLR/CBDT) 넣기 결정이 먼저. 나머지는 수요가 생기면 |
| | Markdown: 참조식 링크, HTML 블록, 목록 안 여러 문단 | 다른 도구 Markdown 가져오기 요구가 생기면 |
| | 플러그인: 명령 이름 충돌 경고, 읽기 전용 프록시, 겉그리기 갈고리, 플러그인 데이터 실시간 동기화 | 외부 플러그인이 생기면 |
| 패키지 (6-6) | npm 배포 (이름·판 정책), Node PDF용 `fontsFromManifest` | 출시 때 |

**하지 않음 (이유)**

| 항목 | 이유 |
|---|---|
| 표 문단 ¶에 구역 나눔 | 표 뒤 빈 문단에 걸면 된다 (정본의 표 블록에 문단 속성이 없음) |
| 덮인 셀(병합된 칸)에 걸린 주석 위치 | 정본이 덮인 셀 글을 주인 셀에 합쳐 저장한다. 병합 전에 풀어야 하는 드문 경우 |
| 댓글 메시지 고친 이력 | 버전 이력(4-5)으로 본다 |
| 거부한 서식이 그 사이 남이 바꾼 값을 덮음 | Word와 같은 동작 |
| 프레즌스를 역할과 상관없이 전함 | 보기 사용자도 어디를 보는지 보이는 것이 기대 동작 |
| 계정·로그인·공유 UI | 앱(08 통합)의 일. 엔진은 토큰 → 역할까지 |
| 형식이 담지 못하는 요소 (HTML·Markdown의 구역·머리말·댓글, Word 스타일 모양·테마 글꼴·도형·수식, HWPX 메모 해결·날짜 필드, 길이 반올림 등) | 그 형식의 한계. 가져올 때 보고하고 주요 요소 표(15 §6.1)에 적었다 |
| 이전 형식 HWP(바이너리) | HWPX로 충분. 한글이 HWPX를 기본으로 저장한다 |
| PDF에 편집 표시(손잡이·선택) | 의도 |
| `createEditor`의 `assets`(wasmUrl 등) 옵션 | 편집기 옵션(`fonts`, 자산 저장소)으로 대신했고 예제 6개가 그것으로 돈다 |
| Vue·Svelte 공식 래퍼 (O-18) | 예제의 컴포저블·`onMount` 수십 줄이면 된다 (6-6) |

**열린 질문 (미해결)**: O-4(표 행·열 이동과 병합의 동시 편집), O-6(단 균형), O-15(로그 압축과 버전 보존), O-17·23(이미지 크기 정책), O-19(SSR 읽기 전용 보기), O-22(표 너비 auto), O-26–29(다단 각주·머리말 크기·각주 이어 쓰기·본문 필드), O-31(최적 줄바꿈), O-33(삭제 제안 수락과 입력이 겹칠 때), O-34(버전 비교 위치), O-36(한국어 검사기), O-38(DOCX·HWPX 확장 요소), O-39(찾기 Worker)는 위 "나중"의 해당 항목과 함께 정한다. O-8(안드로이드 경로 B), O-11(스크린리더 포커스)은 6-7.


### 10.7 6-7 실제 환경 (1차, 2026-11-24)

- 환경: Windows 11 · Chrome 157 · Microsoft 한국어 IME · 입력 경로 A (EditContext) · 스크린리더 기록 "없음". 기록 파일: `quire-checklist-2026-11-24.json` (체크리스트 JSON 내려받기).
- 판정: 26개 모두 통과 (V1 12, V2 3, V4 6, V3 5).
- **발견한 문제 (고침)**: 한자 후보를 Enter로 고르면 문단이 하나 더 생겼다 ("韓⏎"). 본문(v2-hanja)에서는 사용자가 바로 지웠고, 표 칸(v4-cell-hanja)에서는 자동 비교가 "韓\n"으로 남았다.
  - 기록: 한자 키로 재변환 → 후보 창에서 keydown(Process/Enter/229) → compositionend("韓"). 한글 음절을 끝낸 Enter와 달리 같은 누름의 두 번째 keydown(Enter/13)이 오지 않는다.
  - 고침: 조합 중 Enter는 확정한 글이 한글일 때만 문단도 나눈다 (`splitsOnEnter`: 한자·가나가 있으면 고르기만). 일본어 IME의 변환 확정 Enter도 같은 규칙으로 나누지 않는다. (#75)
  - 재확인: 고친 뒤 사용자가 실제 IME로 v4-cell-hanja를 다시 돌려 문단이 더 생기지 않음을 확인했다 (2026-11-24).
- 남은 것:
  - V3(스크린리더): 기록상 스크린리더가 "없음"인 실행이다. 내레이터·NVDA로 실제로 들어 보는 확인은 남았다 (O-11).
  - 확대(17 §10 "화면 확대") 상태의 IME 후보 창 위치는 체크리스트 항목이 아니라 기록이 없다.
  - Edge, 입력 경로 B (textarea)는 아직 돌리지 않았다.

### 10.8 출시 (2026-11-24)

**정한 것** (사용자 결정): 라이선스 MIT (글꼴 패키지는 SIL OFL 1.1), npm 공개 레지스트리의 `@quiredoc` 범위 (조직 `quiredoc`, 2026-11-24 만듦. `quire` 조직 이름은 이미 남의 것이라 쓰지 못했다). 패키지 이름은 `@quiredoc/editor`·`@quiredoc/sdk` 등.

**판 정책**

- 모든 `@quiredoc/*` 패키지가 같은 판을 쓰고 함께 낸다 (lockstep). 판은 저장소 루트 `package.json`의 `version` 하나에서 온다 (`scripts/build-packages.mjs`가 읽고 내부 의존도 그 판으로 고정).
- semver. 0.x 동안에는 깨지는 변경이 minor(0.1 → 0.2), 그 밖은 patch. 1.0부터 정석대로.
- 공개 API로 보는 것: 패키지 `exports`의 이름과 타입, CSS 변수·클래스·상태 속성 (17 §10.1), 메시지 키 (18 §9.1), 정본 문서 형식(`QuireDoc.version`)과 `.quire` 파일, 가져오기 보고의 종류(`DropKind`). 이름을 바꾸면 한 판 동안 옛 이름도 받는다 (17 §9 O-45).
- 시험판은 `0.2.0-beta.1`처럼 쓰고 npm `next` 태그로 낸다 (`latest`를 건드리지 않는다). GitHub Release는 prerelease.
- 바뀐 것은 `CHANGELOG.md`의 `[Unreleased]`에 쌓다가 출시 때 판 절로 옮긴다.

**배포 패키지** (`scripts/build-packages.mjs`): MIT, `repository`·`homepage`·`bugs`, `keywords`, `publishConfig.access: public`, 패키지마다 `README.md`(packages/*/README.md)와 `LICENSE`. 글꼴은 OFL과 글꼴별 라이선스 파일.

**절차**

1. 인증은 npm **Trusted Publishing**(GitHub Actions OIDC, 토큰 없음)을 쓴다. npm이 2FA를 건너뛰는 토큰을 줄이고 있어서다 (2026-11 npm 안내: 계정 변경 2026-08, 토큰으로 바로 올리기 2027-01).
   - 신뢰하는 게시자는 패키지마다 npm 설정(Settings → Trusted Publisher → GitHub Actions: 소유자 `leessang10`, 저장소 `quire`, 워크플로 `release.yml`)에 등록한다.
   - 패키지가 아직 없어 등록할 수 없으면 처음 한 번만 다음 중 하나로 올린다: (가) 쓰기 권한 granular 토큰을 저장소 Secrets의 `NPM_TOKEN`에 넣고 태그를 푸시한다(워크플로가 토큰이 있으면 토큰을 쓴다), (나) 이 기기에서 `npm login` 뒤 `node scripts/build-packages.mjs && node scripts/release.mjs --publish` (2FA 코드를 물으면 넣는다). 올린 뒤 10개 패키지에 신뢰하는 게시자를 등록하고 `NPM_TOKEN`은 지운다.
   - 저장소가 비공개면 provenance는 붙지 않는다.
2. `CHANGELOG.md`의 `[Unreleased]`를 `[X.Y.Z] - 날짜`로 옮기고, 루트 `package.json`의 `version`을 X.Y.Z로 → PR → 머지.
3. main에서 `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `.github/workflows/release.yml`: 태그와 판·CHANGELOG 절이 맞는지 → 타입 검사·빠른 시험·골든 → 패키지 빌드 → `scripts/release.mjs --publish`(검사 뒤 의존 순서대로 `npm publish`, 이미 있는 판은 건너뛰므로 실패 뒤 다시 돌려도 된다) → GitHub Release(CHANGELOG 절과 tgz).
5. 손으로 미리 보기: `node scripts/build-packages.mjs && node scripts/release.mjs` (검사와 `npm publish --dry-run`). 워크플로를 `workflow_dispatch`로 돌리면 기본이 dry-run이다.

**확인**: 이 기기에서 0.1.0으로 빌드해 `release.mjs`의 검사와 10개 패키지 `npm publish --dry-run`이 통과했다. npm에 `@quiredoc/*` 패키지는 없다(404). 범위(조직)의 주인은 로그인 없이 알 수 없다.

**한계**: 저장소가 비공개라 npm provenance(`--provenance`)를 쓰지 않는다. `repository` 링크도 남에게는 열리지 않는다. 저장소를 공개하면 워크플로에 `id-token: write`와 `--provenance`를 더한다.

**0.1.0 출시 기록 (2026-11-24)**

- 이 기기에서 사용자가 `npm login` 뒤 `node scripts/release.mjs --publish`로 10개를 올렸다. 처음에는 스크립트가 npm 출력을 가로채 OTP를 묻지 못해 EOTP로 멈췄다 → 터미널에 붙여 돌리게 고쳤다 (#82).
- npm이 새 패키지를 **단계 게시(staged publishing)**로 받았다: 이름마다 `0.0.0-stage` 자리표시(빈 껍데기, `latest`)가 먼저 생기고, 실제 0.1.0이 뒤따라 공개됐다. 레지스트리 응답은 한동안 자리표시만 보였다(캐시). `@quiredoc/layout`은 0.1.0이 빠져 있어 한 번 더 돌려 올렸다 (이미 있는 판은 건너뛴다). 계정의 Staged Packages 화면에는 기다리는 것이 없었다.
- 확인: 10개 모두 `latest` = 0.1.0 (MIT, fonts는 OFL-1.1). 빈 폴더에서 `npm install @quiredoc/sdk @quiredoc/react @quiredoc/convert @quiredoc/pdf @quiredoc/fonts`가 0건 취약점으로 설치되고, Node에서 Markdown 가져오기(버린 요소 보고 `horizontalRule`)·HWPX·Markdown 내보내기, `@quiredoc/editor/i18n/en`, `tokens.scss`, 글꼴 조각이 동작한다.
- 남은 것: 패키지마다 Trusted Publisher(GitHub Actions, `leessang10/quire`, `release.yml`) 등록. 그 뒤 출시는 태그로.

**Trusted Publisher 설정 (2026-11-24 결정: 완전 자동)**

- 패키지마다 npm Settings → Trusted Publisher → GitHub Actions: 소유자 `leessang10`, 저장소 `quire`, 워크플로 `release.yml`, 환경 이름 비움. **Allowed actions에서 "Allow npm publish"를 켠다**: npm 기본값은 `npm stage publish`만 허용이라, 켜지 않으면 워크플로의 `npm publish`가 거절된다. 태그를 푸시하면 2FA 승인 없이 바로 공개된다 (사용자 선택. 대안은 워크플로가 `npm stage publish`(npm 12)만 하고 사람이 Staged Packages에서 승인하는 방식).
- 등록하면 상태가 "Pending validation"이고, 정해진 기한(처음 등록에서는 약 2일, 2026-11-26 08:23 UTC) 안에 이 워크플로로 한 번 올려야 확인된다. 기한을 넘기면 다시 등록해야 할 수 있다. 다음 판(예: 0.1.1) 태그를 기한 안에 푸시하면 된다 (사용자가 직접).
- 10개 패키지 모두에 같은 설정이 있어야 한다. 하나라도 빠지면 그 패키지에서 `release.mjs`가 멈추고, 고친 뒤 다시 돌리면 이미 올라간 것은 건너뛴다.
