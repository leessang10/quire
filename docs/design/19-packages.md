# 19. 패키지 구성 (core + 조립)

- 상태: 설계 (2026-11-24). 0.2.0에서 바꾼다. P-1–P-5 끝남 (§8).
- 범위: npm에 내는 패키지의 경계·이름·의존 방식, 기능을 골라 붙이는 방법, 0.1.0에서 옮기는 단계.
- 범위 밖: 편집기 기능 자체. 저장소 안의 개발 구조(워크스페이스 폴더)는 거의 그대로 둔다.
- 바탕: 08(통합·임베드), 15 §19(플러그인 API), 16 §10.1·§10.8(빌드·출시).

## 1. 왜 바꾸나

0.1.0의 패키지 열 개는 "만든 순서"대로 나뉘어 있어 기능 경계와 맞지 않는다.

- **협업이 사실상 필수다.** 정본 문서 JSON(`QuireDoc`, `documentFromQuire`·`quireFromDocument`)과 `.quire` 파일이 `@quiredoc/sync`(협업) 안에 있다. 저장·불러오기를 하려면 `sdk`가 `sync`를 가져오고, `sync` 묶음은 맨 위에서 `loro-crdt`를 부른다.
  - 측정 (2026-11-24, `examples/react-vite` 프로덕션 빌드): 협업을 쓰지 않는 기본 앱이 시작할 때 **5,072 KB 조각을 정적으로 받고, 그 안에 Loro가 통째로 들어 있다**. `loro-crdt` 설치 크기 21 MB.
- **쓰는 사람에게는 쪼개진 의미가 없다.** model·layout·shaping은 혼자 쓸 일이 없고, 판도 늘 함께 움직인다(내부 의존 정확히 고정). 열 개를 따로 내도 사용자는 `sdk`나 `react` 하나를 깔고 나머지는 딸려 온다.
- **변환·PDF가 편집기 전체에 기댄다.** `convert`는 편집기의 HTML 읽기(`htmlToFragment`)와 보고 종류(`DropKind`), `pdf`는 쪽 그리기(`PagePainter`, `Formatter`)를 쓴다. 이것 자체는 맞다(같은 코드를 두 번 두지 않는다). 다만 그래서 편집기와 같은 묶음에 있어야 할 것들이 다른 패키지로 흩어져 있다.
- **출시 손이 많다.** 패키지마다 Trusted Publisher 등록·검증, 단계 게시 자리표시가 있다 (16 §10.8).

## 2. 원칙: NestJS식 core + 모듈

`@nestjs/core`·`@nestjs/common`을 두고 `@nestjs/jwt`·`@nestjs/redis`를 붙이듯, 편집기가 혼자 도는 데 필요한 것을 `core` 하나에 두고 **무거운 외부 의존이 있는 기능만** 따로 낸다.

1. **core만으로 편집기가 돈다**: 편집·조판·서식·표·각주·다단·머리말·댓글·제안·버전 보기·찾기·테마·다국어·문서 JSON 저장/불러오기·`.quire` 파일.
2. **떼는 기준은 외부 의존의 무게다**: Loro(협업), HarfBuzz 부분화(PDF), ZIP·XML 문서 형식(변환), 글꼴 파일. 쓰지 않는 앱은 설치·묶음에 넣지 않는다.
3. **조판에 얽힌 기능은 떼지 않는다**: 표·각주·다단·머리말·제안은 쪽 나눔과 맞물려 엔진 안에서 계산된다. Nest의 기본 파이프·가드처럼 core에 둔다. 크기는 core 안에서 필요할 때 불러오기(동적 `import()`)로 줄인다 (이미 셰이핑·영어 번역이 이렇게 한다).
4. **모듈은 core를 peerDependency로 둔다**: 앱에 core가 하나만 있게 한다 (두 사본이면 `instanceof`·전역 상태가 갈라진다). 0.x 동안 `"@quiredoc/core": "^0.2.0"`처럼 같은 minor만.
5. **판은 함께 올린다**: 0.x 동안 모든 패키지가 같은 판 (16 §10.8 그대로). 1.0 뒤에는 Nest처럼 core 묶음과 모듈을 따로 올릴 수 있다 (O-50).
6. **조립은 플러그인으로**: 기능 모듈은 `QuirePlugin`(15 §19)을 낸다. 앱은 `createEditor({ plugins: [...] })`에 넣는다.

## 3. 패키지 (0.2.0)

| 패키지 | 내용 (지금의 어디서) | 외부 의존 | 성격 |
|---|---|---|---|
| `@quiredoc/core` | model, layout, shaping, editor, sdk(`createEditor`), 문서 JSON·`.quire` 파일(sync의 `canonical`·`zip`·`quire-file`에서 Loro 없는 부분) | harfbuzzjs (셰이핑 WASM) | 필수 |
| `@quiredoc/react` | React 바인딩 (그대로) | react (peer) | 선택 |
| `@quiredoc/collab` | 실시간 협업·프레즌스·사용자별 실행 취소의 동기화 쪽·버전 이력·비교·Worker 호스트·WebSocket 전송·`.quire` 이력(history/crdt.bin) (지금의 sync에서 나머지) | loro-crdt | 선택 |
| `@quiredoc/convert` | HWPX·DOCX·Markdown·HTML 가져오기·내보내기 (그대로) | 없음 (자체 ZIP·XML) | 선택 |
| `@quiredoc/pdf` | PDF 내보내기, Node에서 정본 → PDF (그대로) | harfbuzzjs (부분화) | 선택 |
| `@quiredoc/fonts` | 글꼴 조각 (그대로) | — | 선택 (자산) |

- 열 개 → 여섯 개. `model`·`layout`·`shaping`·`editor`·`sync`·`sdk`는 0.2.0부터 내지 않는다 (§6 사용 중단 안내).
- 0.1.0과 이름이 같은 `react`·`convert`·`pdf`·`fonts`는 Trusted Publisher 설정을 그대로 쓴다. 새 이름 `core`·`collab`은 처음 한 번 사람이 올린 뒤 등록한다 (16 §10.8과 같은 절차).

### 3.1 쓰는 모습

```ts
// 편집기만 (협업·변환·PDF 없음): Loro·변환 코드가 묶음에 들어가지 않는다
import { createEditor } from '@quiredoc/core';
const editor = await createEditor({ host, fonts });

// 협업을 붙인다
import { collab } from '@quiredoc/collab';
const editor = await createEditor({ host, fonts, plugins: [collab({ url: 'wss://…', room: 'doc-1', user })] });

// 파일 변환·PDF는 필요할 때 동적으로 (예제가 이미 이렇게 한다)
const { importHwpx } = await import('@quiredoc/convert');
```

### 3.2 core의 하위 경로

| 경로 | 내용 |
|---|---|
| `@quiredoc/core` | 공개 API 전부 (§4.3의 이름 정리 뒤 하나의 이름공간) |
| `@quiredoc/core/i18n/en` | 영어 메시지 (18 §9, 지금의 `@quiredoc/editor/i18n/en`) |
| `@quiredoc/core/tokens.scss` | 테마 변수 (17 §10.1, 지금의 `@quiredoc/editor/tokens.scss`) |

- 서버·Node용 "DOM 없는 진입점"(`@quiredoc/core/headless`: 모델·조판·문서 JSON만)은 두지 않는다. ESM 나무 흔들기로 Node에서 편집기 클래스를 쓰지 않으면 묶이지 않고, 지금도 `@quiredoc/editor`를 Node에서 가져와도 DOM을 건드리지 않는다 (0.1.0 설치 확인, 16 §10.8). 필요해지면 더한다 (O-51).

## 4. 옮길 것

### 4.1 sync를 둘로: 문서 JSON은 core로, CRDT는 collab으로

조사 (2026-11-24): `canonical.ts`가 Loro에 닿는 곳은 `displayText(loro)` 하나다 (`shape.ts`의 `readRaw`·`readState`). 나머지 정본 변환은 `@quiredoc/model`만 쓴다. `zip.ts`는 의존이 없다. `quire-file.ts`는 이력(history/crdt.bin)을 쓰고 확인할 때만 Loro를 쓴다.

| 파일 (packages/sync/src) | 줄 | 어디로 | 비고 |
|---|---|---|---|
| canonical.ts | 505 | core (model 폴더) | `displayText(loro)`만 collab으로 |
| zip.ts | 207 | core (model 폴더) | |
| quire-file.ts | 158 | core + collab | core: `packQuire({document|doc|text, assets, history?})`·`openQuire`는 이력을 **불투명한 바이트**로 싣고 돌려준다. collab: `packQuire`에 Loro를 넘기는 쪽, 연 이력을 Loro로 읽고 `stateHash`로 확인하는 `restoreHistory` |
| shape.ts, annotations.ts, comments.ts, bridge.ts, epoch.ts, core.ts, compare.ts, ot.ts, presence*.ts, protocol.ts, client.ts, host.ts, ws.ts | — | collab | |

- 정본·파일을 model 폴더로 옮기는 까닭: 둘 다 `@quiredoc/model`에만 기대고, core 묶음 안에서는 폴더 경계가 보이지 않는다. 저장소 안의 다른 코드(convert·pdf·playground)는 `@quiredoc/model`(개발용 이름)으로 가져오고, 배포 때 `@quiredoc/core`로 바뀐다 (§4.2).

### 4.2 빌드 (`scripts/build-packages.mjs`)

- **배포 단위와 소스 폴더를 떼어 놓는다**: 배포 단위 `core`는 진입점 하나(`packages/core/src/index.ts`, 새로 만듦)가 model·layout·shaping·editor·sdk의 공개 API를 다시 내보낸다. 이 다섯 폴더 사이의 가져오기는 묶음 안으로 들어간다 (지금은 서로 외부).
- **모듈의 내부 이름을 core로 바꾼다**: collab·convert·pdf·react가 `@quiredoc/{model,layout,shaping,editor,sdk}`를 가져오는 것은 배포 묶음에서 `@quiredoc/core`로 바꾼다 (빌드 별칭 또는 결과 바꾸기. 지금 `loro-crdt/base64`를 바꾸는 방식과 같다). 저장소 안 개발은 지금 이름 그대로.
- **peerDependencies**: 모듈의 배포용 `package.json`에서 `@quiredoc/core`를 `peerDependencies`(`^X.Y.0`)로, `devDependencies`에도 넣는다. core는 모듈에 의존하지 않는다.
- **검사 더하기** (`scripts/release.mjs`): core 묶음에 `loro-crdt`·`convert`·`pdf` 코드가 없는지, 모듈이 `@quiredoc/core` 밖의 `@quiredoc/*`를 가져오지 않는지, core 공개 이름에 겹침이 없는지.

### 4.3 공개 이름 정리 (core 하나의 이름공간)

다섯 폴더의 공개 이름을 합치면 324개 중 겹침이 4개다 (2026-11-24, 빌드된 타입 선언으로 셈).

| 이름 | 어디 | 처리 |
|---|---|---|
| `FontMetrics` | shaping (`shaper.ts`), editor (`painter.ts`) | **서로 다른 타입**: shaping 쪽을 `ShapingFontMetrics`로 바꾼다 |
| `QuirePlugin`, `PluginContext`, `Rect` | editor, sdk | sdk가 editor 것을 다시 내보내는 것: 하나만 낸다 |

여기에 정본 이름(`QuireDoc`, `documentFromQuire`, `packQuire` …)이 core에 더해진다. 겹침은 위 검사(§4.2)가 막는다.

### 4.4 협업을 플러그인으로

지금 협업은 앱이 직접 엮는다 (플레이그라운드 `live.ts`: `startSyncWorker` → `client.document`를 `editor.setDocument` …). 0.2.0의 `collab(options)`은 이 엮기를 `QuirePlugin` 하나로 감싼다: 붙을 때 Worker·연결을 열고, 문서·프레즌스·버전을 편집기에 잇고, 떼일 때 닫는다. 낮은 단계 API(`startSyncWorker`, `serveSyncWorker`, `WorkerClient` …)는 그대로 낸다 (직접 엮는 앱).

### 4.5 그 밖에 바뀌는 곳

- 예제 10개·스타일 예제 셋: 의존과 가져오기 (`@quiredoc/sdk`·`editor` → `core`, `sync` → `collab`), `examples/quire-deps.json`.
- 플레이그라운드·동기화 서버(`apps/sync-server`, 배포하지 않음)는 저장소 이름 그대로라 바뀌지 않는다.
- 문서: README 설치 절, 패키지 README 여섯, CHANGELOG(0.2.0, 옮기기 표), 08·15 §19·16 §10.

## 5. 단계 계획

| 단계 | 내용 | 끝났다는 기준 |
|---|---|---|
| P-1 | 정본·파일 옮기기: canonical·zip·quire-file(이력 불투명)을 model 폴더로, `displayText`·이력 복원은 sync에 남김 | sync 없이 저장·불러오기·`.quire` 왕복 시험 통과. 이력이 있는 `.quire`를 core로 열고 다시 저장해도 이력 바이트가 그대로 |
| P-2 | 이름 정리 (§4.3) | 다섯 폴더 공개 이름 겹침 0 (시험) |
| P-3 | core 진입점과 빌드: `packages/core`, 묶기·이름 바꾸기·peer (§4.2), 검사 더하기 | 빌드 결과 여섯 패키지, `release.mjs` 새 검사 통과 |
| P-4 | collab 플러그인 (§4.4) | 플레이그라운드 협업 데모가 `collab()` 하나로 돈다 |
| P-5 | 예제·문서 옮기기 (§4.5), 묶음 크기 확인 | react-vite 기본 앱 묶음에 Loro 없음 (시작 때 받는 JS가 지금 5 MB대 → 수백 KB대), 예제 typecheck·빌드, 골든 |
| P-6 | 0.2.0 출시: core·collab 처음 올리기와 Trusted Publisher 등록, 옛 패키지 사용 중단 안내 (§6) | npm에서 여섯 개 0.2.0, 빈 폴더 설치·동작 확인 |

## 6. 0.1.0에서 옮기기

- **사용 중단 안내**: `npm deprecate @quiredoc/model "@quiredoc/core로 옮겼습니다 (0.2.0)"`처럼 model·layout·shaping·editor·sdk(→ core), sync(→ collab)에. 패키지와 0.1.0은 지우지 않는다 (설치한 사람이 깨지지 않게).
- **가져오기 표** (CHANGELOG 0.2.0에 싣는다):

| 0.1.0 | 0.2.0 |
|---|---|
| `@quiredoc/sdk`, `@quiredoc/editor`, `@quiredoc/model`, `@quiredoc/layout`, `@quiredoc/shaping` | `@quiredoc/core` |
| `@quiredoc/editor/i18n/en`, `@quiredoc/editor/tokens.scss` | `@quiredoc/core/i18n/en`, `@quiredoc/core/tokens.scss` |
| `@quiredoc/sync`의 `QuireDoc`·`documentFromQuire`·`quireFromDocument`·`packQuire`·`openQuire` | `@quiredoc/core` |
| `@quiredoc/sync`의 나머지 (협업·버전·Worker) | `@quiredoc/collab` |
| shaping의 `FontMetrics` | `ShapingFontMetrics` |

- 0.1.0은 오늘(2026-11-24) 낸 첫 판이라 옮기는 비용이 지금 가장 작다.

## 7. 열린 질문

- O-50. 1.0 뒤의 판 정책: core 묶음과 모듈의 판을 Nest처럼 따로 올릴지, 계속 함께 올릴지. 함께 올리면 단순하고, 따로 올리면 모듈만 고친 판을 자주 낼 수 있다.
- O-51. `@quiredoc/core/headless`(DOM 없는 진입점)가 필요한가: 지금은 나무 흔들기로 충분해 보인다. 서버 묶음 크기가 문제가 되면 더한다.
- O-52. 변환을 형식마다 나눌지 (`@quiredoc/hwpx`·`docx`·`markdown`): 지금은 공통 코드(common·xml)를 나누고 HTML 읽기는 core에 있어 이득이 작다. 형식별 외부 의존이 생기면(예: HWP 5 바이너리 읽기) 그때 나눈다.
- O-53. 앞으로의 모듈 후보: 한국어 맞춤법 검사기(`@quiredoc/spellcheck-ko`, 15 O-36), 동기화 서버(`@quiredoc/server`), Vue·Svelte 바인딩(16 §10.1에서 미룬 것).

## 8. 진행

### 8.1 P-1 정본·파일 옮기기 (2026-11-24)

- `canonical.ts`·`zip.ts`·`quire-file.ts`를 `packages/sync/src`에서 `packages/model/src`로 옮기고 `@quiredoc/model`에서 낸다. `canonical.ts`의 `@quiredoc/model` 가져오기는 model 안의 상대 경로로 바꿨다.
- **`.quire` 파일의 이력**: `openQuire`는 history/crdt.bin을 열어 보지 않고 `history`(바이트, 확인하지 않음)로 돌려준다 (0.1.0의 `crdt`, 확인한 값을 대신함). `packQuire({ …, history })`는 바이트를 그대로 싣고 그 정본 해시를 manifest에 적는다.
- **sync에 남긴 것** (`packages/sync/src/history.ts`): `displayText(loro)`, `packQuireWithHistory({ loro, assets })`(Loro 스냅샷을 이력으로), `restoreHistory(opened)`(이력을 Loro로 읽어 화면 상태 정본 해시가 document.json과 같으면 그 스냅샷, 아니면 null과 `notes`). 동기화 서버의 내려받기·`.quire`로 방 만들기가 이 둘을 쓴다.
- 가져오기를 옮겼다: convert·pdf·sdk·플레이그라운드·동기화 서버·예제 공통 코드(`examples/shared/quire-app.ts`)·시험. **convert·pdf·sdk는 이제 sync에 의존하지 않는다** (package.json에서 뺐다).
- 시험: `packages/model/src/quire-file.test.ts` — sync 없이 서식·자산 왕복, 이력 바이트가 열기 → 다시 저장에서 그대로이고 manifest에 정본 해시가 적힘, 그리고 model·layout·shaping·editor·sdk·convert·pdf 소스와 package.json이 `loro-crdt`·`@quiredoc/sync`를 가져오지 않음. sync의 파일 시험은 `packQuireWithHistory`·`restoreHistory`로 (이력이 문서와 다르면 버림, 다시 포맷만 했으면 유지).
- **효과 (측정)**: `examples/react-vite` 프로덕션 빌드에서 시작 때 받는 JS가 5,261 KB(5,072 KB 조각에 Loro) → **492 KB**, 묶음 어디에도 Loro 없음. 앱은 그대로 돈다 (브라우저 확인, 콘솔 오류 없음). 0.2.0 패키지 구성 전이지만 sdk가 sync를 떼어 낸 것만으로 §1의 문제가 풀린다.
- 예제의 `package-lock.json`(git에 넣지 않음)에 옛 tgz 체크섬이 남아 있으면 `EINTEGRITY`로 설치가 실패한다: 같은 판 0.1.0의 tgz 내용이 바뀌었기 때문. 지우고 다시 설치한다.

### 8.2 P-2 이름 정리 (2026-11-24)

- shaping의 `FontMetrics`(셰이핑 글꼴 치수, em 비율)를 `ShapingFontMetrics`로 바꿨다. 편집기의 `FontMetrics`(그리기 치수, px)는 그대로.
- `QuirePlugin`·`PluginContext`·`Rect`는 sdk가 editor 것을 다시 내보내는 것이라 같은 타입이다: 겹침으로 치지 않는다 (core 진입점에서는 한 번만 낸다, P-3).
- 시험 `packages/sdk/src/core-names.test.ts`: model·layout·shaping·editor·sdk 진입점이 **스스로 내는** 이름(다른 `@quiredoc/*`를 다시 내보내는 것 제외)이 서로 겹치지 않는다. 고치기 전 코드에서는 `FontMetrics: shaping, editor`로 실패하는 것을 확인했다.

### 8.3 P-3 core 진입점과 빌드 (2026-11-24)

- `packages/core`(개발용 이름 `@quiredoc/core`): `src/index.ts`가 model·layout·shaping·editor·sdk를 `export *`로 다시 낸다. 겹침은 P-2 시험이 막고, sdk가 editor 타입을 다시 내는 것은 같은 바인딩이라 TypeScript도 받는다.
- `scripts/build-packages.mjs`를 **배포 단위** 기준으로 바꿨다 (`UNITS`: core·collab·convert·pdf·react + fonts). 저장소 폴더와 1:1이 아니다: core는 다섯 폴더를 묶고, collab의 소스는 `packages/sync`.
  - core: 다섯 폴더 사이 가져오기는 묶음 안으로(외부는 harfbuzzjs뿐). 하위 경로 `i18n/en`(편집기의 지연 로딩도 같은 파일), `tokens.scss`. 타입은 `dist/types/<폴더>/`에 두고 서로의 `@quiredoc/<폴더>`를 상대 경로로 바꾼다.
  - 모듈: 결과 JS·타입에서 `@quiredoc/{model,layout,shaping,editor,sdk}` → `@quiredoc/core`, 의존은 `peerDependencies: { "@quiredoc/core": "^판" }`. 모듈이 다른 모듈에 기대면 빌드가 멈춘다.
- `scripts/release.mjs`: 순서 core → collab → convert → pdf → react → fonts. 새 검사: `@quiredoc/*` 의존은 peer로만, 모듈의 peer는 `@quiredoc/core@^판`만, core 묶음에 `@quiredoc/*`·`loro-crdt` 가져오기 없음, 모듈 묶음은 `@quiredoc/core` 밖의 `@quiredoc/*`를 가져오지 않음. core 묶음에 `import("@quiredoc/sync")`를 일부러 넣으면 실패하는 것을 확인했다.
- README: `packages/core/README.md`(새로), `packages/sync/README.md`는 `@quiredoc/collab`용으로.
- **결과**: tgz 여섯 개. core `dist/index.js` 619 KB(Loro 없음), `dist/i18n/en.js` 3 KB. 6개 검사·dry-run 통과.
- **설치 확인** (빈 프로젝트에 tgz 여섯을 설치): TypeScript(Bundler 해석)로 core·`core/i18n/en`·collab·convert·pdf·react 공개 이름이 다 풀리고(`skipLibCheck`를 끄면 harfbuzzjs 타입의 `EmscriptenModule` 하나가 남는다: 0.1.0부터 있던 제3자 문제), Node에서 core의 `.quire` 왕복, convert(MD → HWPX), collab의 `packQuireWithHistory` → core `openQuire` → `restoreHistory`, `i18n/en`이 돈다. 모듈은 앱의 core 하나를 함께 쓴다 (peer).
- 남은 것 (P-5): 예제들은 아직 옛 tgz 이름(`quiredoc-sdk-…` 등)을 가리키므로 **새로 설치하면 실패한다** (이미 설치한 node_modules로는 돈다). P-5에서 예제를 core·collab으로 옮긴다.

### 8.4 P-4 협업 플러그인 (2026-11-25)

- `collab(options)` (`packages/sync/src/collab.ts`, 배포는 `@quiredoc/collab`): `QuirePlugin` 하나. 붙으면 Worker를 시작해 서버에 연결하고, 공유 문서를 편집기에 넣고(`ctx.sync.setDocument`), 원격 변경(`documentChanged`)·다른 사람 캐럿(`setRemoteCarets`)·서버가 정한 권한(`setAccess`)·새 판(다시 `setDocument`)을 편집기에 잇고, 편집기의 `selection` 이벤트를 서버로 보낸다(셀·머리말의 스토리와 쪽까지). 떼면 이벤트를 떼고 연결을 닫고, 함수로 받은 Worker는 끝낸다.
  - 옵션: `worker`(앱이 만든 Worker 또는 만드는 함수: 번들러마다 Worker 만드는 법이 달라 앱 몫), `url`, `user`, `peer?`, `text?`(빈 방의 첫 글), `batchMs?`, 알림 `onReady`·`onStatus`·`onRole`·`onReset`·`onPresence`(앱 화면용). 플러그인의 `client`(연결된 `WorkerClient`)와 `ready`(연결해 문서를 넣으면 풀림).
  - 연결 전에는 보기만 (그 전에 쓴 글은 공유 문서로 바뀌며 사라지므로). 플러그인 하나는 편집기 하나에만.
- **플러그인 면을 넓혔다** (`PluginContext`): `sync.setDocument`·`sync.documentChanged`·`sync.setRemoteCarets`·`sync.setAccess`(편집기 밖에서 문서가 바뀌는 플러그인용, 문서를 고치는 길은 그대로 `edit`·`editDocument`), `selection()`에 `page`(머리말·꼬리말을 편집 중인 쪽). sync는 editor의 **타입만** 가져온다(배포 묶음에서는 `@quiredoc/core`, 실행 코드에는 없음).
- 플레이그라운드 실시간 페이지(`apps/playground/src/live.ts`)가 `editor.use(collab({...}))` 하나로 돈다: 직접 엮던 Worker 시작·편집기 콜백·권한·새 판 처리를 뺐고, 앱은 상태 줄·접속자 목록·파일·버전만 그린다. 나갈 때 `editor.destroy()`가 플러그인 정리로 연결을 닫는다.
- 확인: 동기화 서버 + 두 탭 — 한 탭에서 친 글이 다른 탭에 오고, 다른 탭에 그 사람 캐럿·이름표(팔레트 1번)가 그려지고, 접속자 목록이 서로 보이고, 한 탭에서 `editor.destroy()`하면 다른 탭의 접속자가 1명으로. 콘솔 오류 없음. 시험 `packages/sync/src/collab.test.ts`(실제 서버, 가짜 PluginContext): 연결 전 보기만 → 연결 뒤 공유 문서·편집 권한, 두 플러그인 사이 편집 전달과 원격 변경 알림, 선택 → 상대 캐럿(색 포함), 정리(이벤트 떼기·client null·만든 Worker 끝내기), 두 편집기에 붙이기 거부.

### 8.5 P-5 예제·문서 옮기기 (2026-11-25)

- 예제 10개(vanilla·react-vite·next·vue·svelte·node·react-full·next-shadcn·next-word·next-notion)의 의존을 `@quiredoc/core` + 쓰는 모듈(react·convert·pdf·fonts)로, 가져오기·주석·README의 `@quiredoc/{sdk,editor,model,layout,shaping,sync}`(하위 경로 `i18n/en`·`tokens.scss` 포함)를 `@quiredoc/core`로. 예제는 협업을 쓰지 않아 collab을 설치하지 않는다 (예제에서 sync를 쓰던 곳은 P-1에서 옮긴 `.quire` 열기·저장뿐이었다). `examples/quire-deps.json`도.
- 설치: 10개 모두 새 tgz로 설치된다 (P-3 뒤 새로 설치하면 실패하던 문제가 풀림). 예제의 `package-lock.json`(git에 넣지 않음)은 지우고 다시 만들었다.
- 확인:
  - TypeScript: react-vite·next·vue·react-full·next-shadcn·next-word·next-notion 통과, svelte는 `svelte-check` 오류 0.
  - 프로덕션 빌드: Vite 다섯(vanilla·react-vite·vue·svelte·react-full)과 Next.js 넷(next·next-shadcn·next-word·next-notion) 모두 성공.
  - **묶음에 Loro 없음**: Vite 다섯·Next 넷 모두 Loro가 든 조각이 0개. 시작 때 받는 JS: vanilla 350 KB, vue 413 KB, react-vite 531 KB, react-full 616 KB (0.1.0의 react-vite는 5,261 KB).
  - Node 예제: Markdown → PDF·HWPX·DOCX, HWPX → Markdown.
  - 브라우저: react-full이 오류 없이 뜨고, `.quire` 저장이 core의 `packQuire`로 돈다.
- 문서: 저장소 README 설치 절(core + 모듈, collab), examples/README, CHANGELOG `[Unreleased]`를 배포 패키지 기준으로 다시 씀(옛 → 새 이름 표).
