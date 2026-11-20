# 16. 출시 준비와 안정화 (6단계)

- 상태: 진행 중 (6-6, 6-1 끝남)
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
| R6 | 패키지로 쓸 수 있다 | `@quire/*`가 빌드되어(ESM + 타입) 저장소 밖 예제 앱에서 설치해 쓸 수 있다 |
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
- 플레이그라운드 `?bench=1`: 1,000쪽 문서를 열고 각 지표를 재어 `window.benchResult`(JSON)에 둔다. 입력은 EditContext·textarea에 합성 이벤트를 넣어 키 → 그리기까지 잰다.
- 결과를 저장소의 `bench/baseline.json`과 비교하는 스크립트. 기준선보다 20% 넘게 나쁘면 실패.
- CI의 브라우저 실행은 6-1의 범위 밖이다 (이 저장소에 브라우저 자동화 도구가 없다). 손으로 또는 브라우저 창으로 돌린다.

## 5. 6-3 레이아웃 골든 시험

- 기준 문서 세트(12 §13, `fixtures/docs`)를 저장소 글꼴로 셰이핑·조판한 쪽 나눔과 줄 나눔의 지문.
- Node 시험이 지문을 기준값과 비교한다. 브라우저(플레이그라운드)에서 같은 지문을 내어 같은지 본다. Firefox는 이 기기에 있으면 확인한다.

## 6. 6-4 보안·견고성

- 링크: `javascript:`·`data:`·`vbscript:` 등 위험한 스킴을 가져오기·붙여넣기·내보내기(HTML·PDF·DOCX·HWPX)에서 막는다 (허용: http, https, mailto, tel, 문서 안 #).
- 크기 상한: zip 항목 수·풀린 크기(zip 폭탄), XML 깊이, 이미지 크기, 문단 수.
- 퍼즈: 정상 파일을 바이트·구조 단위로 무작위로 망가뜨려 가져오기·`.quire` 열기가 예외(설명 있는 오류는 괜찮다)나 멈춤 없이 끝나는지.

## 7. 6-5 남은 일

- 대상: 12·14·15의 결과 절 "한계·다음"(약 80개)과 열린 질문(37개 중 미해결).
- 분류: 고침(6단계), 나중(이유), 하지 않음(이유). 이 문서 §10에 표.

## 8. 6-6 패키지

- 지금은 모든 패키지가 `exports: ./src/index.ts`(소스 그대로)다. 빌드해 `dist`(ESM + .d.ts)를 내고, 개발은 계속 소스로 한다.
- WASM·글꼴 자산의 위치를 앱이 정하게 한다 (08 §3 `assets`).
- 예제는 두 축을 덮는다: **에디터 수명주기**(프레임워크: 바닐라, React, Next.js, Vue, SvelteKit)와 **전역 스타일 충돌**(CSS: 순수 CSS, Tailwind preflight, styled-components, SCSS, scoped). 조합을 다 만들지 않고 프레임워크마다 CSS 하나씩, 그리고 DOM 없는 Node 변환기 하나 — 모두 여섯.

## 9. 6-7 실제 환경

- 이 기기: Windows 11, Chrome·Edge(·Firefox가 있으면), 한글 IME. 플레이그라운드 `/checklist.html`을 돌려 기록한다.
- 이 기기에 없는 환경(macOS·iOS·Android, VoiceOver)은 할 수 없다고 적는다.

## 10. 결과

### 10.1 6-1 CI

- `.github/workflows/ci.yml`: 푸시(main)·PR마다 `fast` 작업(`npm ci` → `npm run typecheck` → `vitest.fast.config.ts`). 매일 03:00(KST)과 손으로 돌릴 때 `slow` 작업(`vitest.slow.config.ts`, 제한 180분).
- `vitest.slow.ts`: 느린 파일 목록. 빠른 설정은 이 목록을 빼고, 느린 설정은 이 목록만 돈다. 기본 `vitest run`(전체)은 그대로다.
- 시간 표는 §3.1.

**한계**

- Ubuntu 러너에는 Windows 글꼴(맑은 고딕·Calibri)이 없어서 셰이핑 시험 둘(`packages/shaping/src/shaper.test.ts`, `spikes/shaping/src/shaping.test.ts`)은 CI에서 건너뛴다. 저장소 글꼴(Noto Sans KR·Pretendard)로 돌리는 시험은 그대로 돈다. 글꼴을 저장소 글꼴로 옮기는 일은 6-3(레이아웃 골든)에서 한다.
- Word·한글로 다시 저장한 파일을 쓰는 시험(`QUIRE_WORD_RESAVED`·`QUIRE_HWP_RESAVED`)은 환경 변수가 없으면 건너뛴다. 그 파일은 이 기기에서만 만든다.
- 브라우저 시험(6-2 벤치마크 등)은 CI에서 돌리지 않는다.
- 첫 CI 실행 시간은 이 PR에서 확인한다.

### 10.2 6-6 패키지와 예제 앱

**빌드** (`scripts/build-packages.mjs`, 결과는 `.build/`, 저장소에는 넣지 않음)

- 순서: model → layout → shaping → editor → sync → convert → pdf → sdk → react. 판은 모두 0.1.0.
- tsc로 선언(.d.ts)을 한 번에 내고, 패키지마다 Vite 라이브러리 모드로 ESM 하나(`dist/index.js`). 의존성은 모두 외부로 둔다.
- 배포용 `package.json`을 새로 쓴다: `exports`의 `types`·`import`, 내부 의존성은 0.1.0으로 고정.
- `loro-crdt` 가져오기를 `loro-crdt/base64`로 바꾼다: WASM을 base64로 품은 진입점이라 앱 번들러에 WASM 설정이 필요 없다. 별칭(alias)으로는 안 된다 — 외부 처리가 별칭보다 먼저라서 빌드 결과의 문자열을 바꾼다.
- `@quire/fonts`: 플레이그라운드의 글꼴 조각·manifest·라이선스를 묶은 자산 패키지.
- `npm pack`으로 `.build/packs/*.tgz`.

**예제** (`examples/`, 워크스페이스 밖, tarball만 설치)

| 예제 | 프레임워크 | CSS | 붙이는 방법 | 포트 |
|---|---|---|---|---|
| vanilla | HTML + JS (Vite 8) | 순수 CSS | `createEditor` | 5301 |
| react-vite | React 19 + Vite 8 | Tailwind 4 (preflight) | `useQuire`·`QuireEditor`·`useEditorState`, StrictMode | 5302 |
| next | Next.js 16 App Router (Turbopack) | styled-components (SSR 레지스트리) | @quire/react + `next/dynamic` `ssr: false` | 5303 |
| vue | Vue 3 + Vite 8 | SCSS | `createEditor` + 컴포저블 | 5304 |
| svelte | SvelteKit 3 + Svelte 5 | scoped | `onMount`에서 동적 `import('@quire/sdk')` | 5305 |
| node | Node 22 | — | `@quire/convert` + `pdfFromQuire` CLI | — |

브라우저 다섯 개 모두: 서식 버튼 상태 반영, 실행 취소·다시 실행, 문단 스타일, 예제 플러그인(글자 수·강조 낱말), 열기(HWPX·DOCX·MD·HTML), 저장(HWPX·DOCX·MD·PDF)을 확인했다. Node: MD → PDF·HWPX·DOCX, HWPX → MD, DOCX → PDF.

**써 보고 고친 것** (라이브러리)

| 발견 | 고침 |
|---|---|
| SDK로 파일을 열 방법이 없었다 | `createEditor().load(doc, assets)`, React 컨트롤러 `load` |
| PDF가 DOM에 묶여 있었다 (편집기 `printSource()`만) | `pdfFromQuire(q, {fonts, subsetter, asset})`: DOM 없이 조판해 PDF. `@quire/pdf`가 `@quire/sync`에 의존 |
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
- Vue·Svelte용 공식 래퍼는 없다 (예제의 컴포저블·onMount 수준이면 충분해 보인다). 필요해지면 `@quire/vue` 등.
- Node에서 PDF를 만들려면 앱이 글꼴 바이트를 manifest에서 모아 넘겨야 한다. 편의 함수(`fontsFromManifest`)는 6-5 후보.
