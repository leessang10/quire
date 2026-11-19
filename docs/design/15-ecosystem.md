# 15. 생태계 (5단계)

- 상태: 설계 초안
- 범위: 06 5단계. 찾기·바꾸기, 맞춤법 검사, 쪽 그리기 분리와 PDF 내보내기·인쇄, 교환 포맷(Markdown·HTML·DOCX·HWPX), 플러그인 API.
- 바탕: 00(아키텍처: 기능 플러그인 층), 01(문서 모델, 주석), 04(찾기 §4, 맞춤법 §5, 클립보드 §6, 인쇄 §7), 07(파일 §4 정본, 교환 포맷 §5), 08(공개 API, 서버 실행 §6), 11(스토리·표), 12(조판), 14(주석·제안·보기 모드).

## 1. 목표

캔버스 편집기는 `contenteditable`이 공짜로 주던 기능(찾기, 맞춤법, 인쇄)을 직접 되찾아야 한다 (00 원칙 5). 또 다른 프로그램과 문서를 주고받아야 쓸 수 있다. 5단계는 이 둘과, 앱이 기능을 덧붙일 수 있는 플러그인 API다.

| # | 목표 | 끝났다는 기준 |
|---|---|---|
| G1 | 찾기·바꾸기: 모든 스토리(본문·셀·머리말·꼬리말·각주), 대소문자·낱말 단위·정규식, 바꾸기·모두 바꾸기 | 1,000쪽 문서에서 모두 찾기 200 ms 안(Worker 밖에서도), 찾은 상태로 입력 p95 16 ms 그대로, 모두 바꾸기가 실행 취소 한 번 |
| G2 | 맞춤법 검사: 검사기 인터페이스, 문단 단위 증분 검사, 물결 밑줄, 고칠 말 메뉴, 무시·사전에 더하기 | 입력 중 보이는 문단만 검사하고 입력 p95 16 ms 그대로, 한 문단 고치면 그 문단만 다시 검사 |
| G3 | 쪽 그리기 분리: 편집기 상태 없이 레이아웃만으로 쪽을 그리는 그리기기(`PagePainter`)와 그리기 대상 인터페이스 | 편집기 화면 그리기가 이것을 쓰고, 같은 쪽을 Node에서 그려도 같은 그리기 명령 열 (지문 시험) |
| G4 | PDF 내보내기·인쇄: 글꼴 포함(부분), 글자 선택·복사 되는 PDF, 이미지·표 선·밑줄, 링크와 개요(책갈피) | 기준 문서 세트를 PDF로 냈을 때 쪽 수·쪽마다 첫 줄이 화면과 같음, 1,000쪽 10초 안, PDF에서 복사한 글자 = 문서 글자 |
| G5 | 교환 포맷: Markdown·HTML 문서 단위 가져오기·내보내기, DOCX·HWPX 가져오기·내보내기 ("주요 요소 보존", 00 §2) | 기준 문서 세트 왕복(내보내기 → 가져오기)에서 주요 요소 표(§6.1)의 요소가 모두 남음, 내보낸 파일을 Word·한글이 연다 (사람 확인) |
| G6 | 플러그인 API: 명령·단축키·장식(비영속 범위)·주석 종류 그리기·내보내기 형식·문서 확장 데이터 | 찾기와 맞춤법을 플러그인 API 위에서 다시 짜도 동작이 같음, 예제 플러그인 2개 |

React 래퍼와 서버 패키지(08)는 5단계 끝에 공개 API를 정리하면서 함께 한다 (§8).

## 2. 장식: 비영속 범위 (G1·G2·G6의 바탕)

찾기 결과와 맞춤법 오류는 문서가 아니다. 저장·동기화·실행 취소에 들어가면 안 되고, 피어마다 다르다. 04 §4·§5는 이것을 "비영속 주석"이라 했다. 14의 주석 레이어와 겉모양(범위, 그리기)은 같지만 데이터 경로는 따로 둔다.

```ts
interface Decoration {
  story: StoryId | null;
  from: number; // 그 스토리의 화면 오프셋
  to: number;
  kind: string; // 'find' | 'find-current' | 'spell' | 플러그인 종류
  data?: unknown;
}

interface DecorationSource {
  /** 보이는 문단 범위의 장식. 그리기마다 부른다 */
  decorationsIn(story: StoryId | null, from: number, to: number): readonly Decoration[];
  /** 문서가 바뀌면 바뀐 범위를 받아 자기 장식을 옮기거나 다시 계산한다 */
  onChange?(change: DocChange): void;
}
```

- 장식은 **오프셋**으로 둔다 (원소 ID가 아니다). 값이 짧게 살고, 바뀌면 다시 계산하는 편이 싸다.
- 편집기는 `commit`마다 바뀐 범위(스토리, 문단 범위, 오프셋 차이)를 장식 소스에 알린다. 소스는 바뀐 문단의 장식을 버리고 그 뒤 장식을 오프셋 차이만큼 옮긴 다음, 바뀐 문단만 다시 계산한다.
- 그리기는 14 §2.4의 주석 그리기 경로를 같이 쓴다: 오버레이에 종류별 그리기 함수(바탕색, 물결 밑줄, 테두리).
- 보기 모드(14 §4.3)의 최종본·원본은 파생 문서다. 장식은 그 파생 문서의 오프셋으로 계산한다 (찾기는 보이는 글자를 찾는다).

## 3. 찾기·바꾸기 (G1)

### 3.1 검색

- Ctrl+F(macOS ⌘F)를 가로채 찾기 막대를 연다. Ctrl+H는 바꾸기 줄까지 연다. 막대 UI는 플레이그라운드가 만들고 편집기는 API만 낸다 (08 R3):

```ts
editor.find(query: FindQuery): FindResult;       // 모두 찾기, 현재 = 캐럿 뒤 첫 결과
editor.findNext(); editor.findPrev();
editor.replace(text: string): boolean;           // 현재 결과를 바꾸고 다음으로
editor.replaceAll(text: string): number;         // 한 트랜잭션
editor.clearFind();
interface FindQuery { text: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; stories?: 'all' | 'body' }
```

- 찾는 대상은 스토리마다의 문단 텍스트다 (`Doc.paragraphs()`의 `text`). 개체 글자(표·각주 참조·이미지)는 U+FFFC라 낱말 경계가 된다. 표는 셀 스토리를 문서 순서(행, 열)로 찾는다.
- 문단을 넘는 결과는 찾지 않는다 (정규식의 `\n`도 문단 안 줄바꿈만). Word와 같다.
- 낱말 단위: 앞뒤 글자가 글자·숫자가 아니면 낱말이다 (`\p{L}\p{N}`). 한글은 조사가 붙어 낱말 단위가 잘 맞지 않으므로 기본은 끈다.
- 대소문자 무시는 `toLocaleLowerCase` 후 길이가 바뀌지 않는 글자에만 쓴다 (길이가 바뀌는 글자는 그대로 비교). 결과 오프셋이 원문과 어긋나지 않게 한다.
- 비용: 1,000쪽 ≈ 문단 2만 개, 글자 200만 자. 문단별 `indexOf`면 수십 ms다. Worker는 두지 않고 메인에서 하되 문단 결과를 캐시해 입력 때 바뀐 문단만 다시 찾는다. 결과 수는 상한(1만)을 두고 넘으면 "1만+"로 보인다. 200 ms를 넘으면 문단 묶음을 나눠 유휴 시간에 찾는다.

### 3.2 보이기

- 모든 결과는 `find` 장식(연한 노랑), 현재 결과는 `find-current`(진한 주황)다.
- 현재 결과로 스크롤한다: 스토리 위치에서 화면 좌표를 구하는 기존 경로(`revealRemote`가 쓰는 `storyLayoutFor`)를 쓴다. 머리말 결과는 그 머리말을 쓰는 첫 쪽에 보인다.
- 스크롤 막대 옆에 결과 위치 눈금을 그린다 (쪽 비율).

### 3.3 바꾸기

- 바꾸기는 그 범위를 지우고 넣는 편집이다. 제안 모드면 제안으로 기록된다 (14 §4: `recordSuggestions`가 그대로 받는다). 읽기 전용(보기 모드·보기 권한)이면 바꾸기를 막는다.
- 바꿀 글자의 서식은 결과 첫 글자의 서식을 따른다 (Word와 같다).
- 정규식 바꾸기는 `$1`·`$&`를 쓴다 (`String.prototype.replace` 규칙).
- 모두 바꾸기는 뒤에서 앞으로 바꿔 오프셋이 밀리지 않게 하고, 연산을 한 트랜잭션으로 묶는다 → 실행 취소 한 번. 동기화에는 한 번에 간다.
- 협업: 찾은 뒤 원격 변경이 오면 장식이 옮겨진다 (§2). 바꾸기 직전에 결과 범위의 글자가 아직 검색어와 맞는지 다시 확인하고, 아니면 건너뛴다.

## 4. 맞춤법 검사 (G2)

### 4.1 검사기 인터페이스

한국어 맞춤법은 사전 단어 목록으로 잘 되지 않는다 (조사·어미 활용, 띄어쓰기). 좋은 검사기는 대개 서버 서비스이고 라이선스가 따로다. 그래서 편집기는 **검사기를 끼우는 자리**만 정하고, 검사기는 앱이 준다.

```ts
interface SpellChecker {
  /** 문단 하나. 같은 글자에는 같은 결과 (캐시 키 = 언어 + 텍스트) */
  check(text: string, lang: string, signal: AbortSignal): Promise<SpellIssue[]>;
  /** 사용자 사전 (선택) */
  addWord?(word: string): void;
}
interface SpellIssue { from: number; to: number; kind: 'spelling' | 'spacing' | 'grammar'; message?: string; suggestions: string[] }
```

- 내장 검사기는 둘이다.
  - `WordListChecker`: 단어 목록 사전 (영어 등, 시험용). 낱말을 잘라 목록에 없으면 오류다.
  - `HttpChecker`: 문단 묶음을 서버로 보내는 어댑터 (요청 모양만 정하고 서비스는 앱이 고른다).
- 한국어 기본 검사기는 정하지 않는다 (O-36).

### 4.2 일정

- 검사 대상: 보이는 문단 ± 여유분, 그다음 유휴 시간에 나머지 문단. 캐럿이 있는 문단은 입력이 멈춘 뒤(500 ms) 검사한다. 입력 중인 낱말은 오류로 보이지 않는다.
- 결과 캐시: (언어, 문단 텍스트) → 결과. 문단을 옮기거나 되돌려도 다시 검사하지 않는다. 캐시는 LRU로 크기를 제한한다.
- 비동기 결과가 왔을 때 문단 텍스트가 이미 바뀌었으면 버린다. 진행 중 검사는 `AbortSignal`로 그만둔다.
- 언어: 문단의 언어 속성이 없으므로 처음에는 문서 기본 언어 하나다 (`ko`). 문자 종류(한글·라틴)로 검사기를 고르는 것은 검사기가 한다.

### 4.3 보이기와 고치기

- `spell` 장식: 빨간 물결 밑줄(띄어쓰기·문법은 파랑).
- 오른쪽 클릭 → 고칠 말 목록, "모두 무시", "사전에 더하기". 고칠 말을 고르면 그 범위를 바꾼다 (보통 편집, 제안 모드면 제안).
- 무시 목록은 문서마다(로컬 상태, 저장하지 않음), 사전에 더하기는 검사기의 `addWord`(앱이 저장)다.
- 미러(04 §3)에는 `aria-invalid="spelling"`을 붙인 `span`으로 알린다.

## 5. 쪽 그리기 분리와 PDF (G3·G4)

### 5.1 그리기기 분리

지금 쪽 그리기는 `Editor` 안에 있다 (`render`, `drawLines`, `drawFloat`, `drawPageHF`, `drawPageNotes`, 표 그리기). 편집기 상태(캐럿, 선택, 활성 스토리, 원격 캐럿, 화면 스크롤)와 섞여 있고 `CanvasRenderingContext2D`에 직접 그린다. PDF와 서버 실행(08 §6)을 위해 둘로 나눈다.

```ts
/** 그리기 대상: Canvas 2D의 부분집합 */
interface PaintTarget {
  save(): void; restore(): void;
  translate(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
  line(x1: number, y1: number, x2: number, y2: number, width: number, color: string, dash?: number[]): void;
  /** 셰이핑한 글리프 열. 화면은 fillText로, PDF는 글리프 ID로 그린다 */
  glyphs(run: GlyphRun, x: number, y: number, color: string): void;
  image(id: string, x: number, y: number, w: number, h: number): void;
  clip(x: number, y: number, w: number, h: number): void;
  link?(x: number, y: number, w: number, h: number, href: string): void;
}

class PagePainter {
  constructor(layout: PagedLayout, document: Document, fmt: Formatter, images: ImageSource);
  /** 쪽 하나의 내용: 본문 줄·표·떠 있는 개체·머리말·꼬리말·각주. 편집기 오버레이는 없다 */
  paintPage(page: number, target: PaintTarget): void;
}
```

- `GlyphRun`은 같은 글꼴 슬롯의 글자 조각과 레이아웃이 정한 코드포인트별 x 위치다 (`Measurer.advances`·`fontsOf`의 결과). 레이아웃은 글리프 ID를 두지 않는다. 화면 대상은 지금처럼 `fillText(text)`로 그리고(같은 글꼴 파일이라 같은 모양, O-12 해소), PDF 대상은 같은 셰이퍼(`HbShaper`, 결정적)로 그 조각을 다시 셰이핑해 글리프 ID를 얻는다 (조각 캐시).
- 편집기의 `render`는 보이는 쪽마다 `paintPage`를 부르고, 그 위에 편집기만의 것(선택, 주석·제안·장식, 캐럿, 원격 캐럿, 활성 스토리 흐리기, 개체 핸들)을 그린다.
- 레이아웃이 아직 준비되지 않은 쪽(백그라운드 조판)은 편집기가 자리표시를 그린다. 그리기기는 준비된 쪽만 받는다.
- 시험: 기록 대상(`RecordingTarget`)으로 그리기 명령을 모아 지문(해시)을 비교한다. Node와 Chromium에서 같은 지문이면 서버 PDF가 화면과 같다.

이 분리는 `editor.ts`(5,200줄)의 가장 큰 리팩터링이다. 단계 5-3이 이것만 한다. 화면 결과가 바뀌지 않음을 기준 문서 세트의 그리기 지문으로 확인하면서 옮긴다.

### 5.2 PDF 작성기

외부 라이브러리 없이 쓴다 (`@quire/pdf`, DOM 없음, Node·브라우저·Worker).

- **글꼴**: 글꼴 슬롯(Pretendard 조각들, Noto Sans KR)은 OpenType CFF(`.otf`)다. 쓰인 글리프만 남긴 부분 글꼴을 만들어 `FontFile3`(`/Subtype /OpenType`)로 넣고, `Type0` + `CIDFontType0` + `Identity-H`로 글리프 ID를 그대로 CID로 쓴다. 부분 글꼴 만들기(CFF 부분화)가 어려우면 첫 단계는 조각 파일을 통째로 넣는다 (조각 하나 250–460 KB, O-37).
- **글자 복사**: 글꼴마다 `ToUnicode` CMap (글리프 ID → 원문 글자). 합자처럼 글리프 하나가 여러 글자면 그 글자열로 매핑한다. 한 글자가 여러 글리프면 첫 글리프에 매핑한다.
- **좌표**: 레이아웃 단위는 정수 1/1000pt (02 §2)라 PDF 사용자 단위(pt)로 나누기만 한다. y축은 뒤집는다.
- **글리프 위치**: `TJ` 연산자에 진행 폭 보정값을 넣어 셰이핑한 진행 폭과 같게 한다 (양쪽 정렬 늘림 포함).
- **이미지**: JPEG는 그대로(`DCTDecode`), PNG는 픽셀을 풀어 `FlateDecode`로 (알파는 `SMask`). 압축은 `CompressionStream('deflate')`(브라우저)와 `zlib`(Node)을 같은 인터페이스로 감싼다.
- **나머지**: 표 선·밑줄·취소선은 선, 배경색은 사각형, 링크는 `Link` 주석, 제목 문단은 개요(책갈피) 트리.
- **크기**: 쪽 내용 스트림은 쪽마다 압축한다. 1,000쪽 10초 목표는 조판(이미 Worker) + 그리기 + 압축이다. 쪽을 하나씩 만들어 스트림으로 내보내 메모리를 쪽 수와 무관하게 둔다.

### 5.3 인쇄

- 브라우저 인쇄(Ctrl+P)를 가로채 PDF를 만들어 새 창에서 연다. 쪽 나눔이 화면과 같다 (04 §7).
- PDF 없이 바로 인쇄하는 경로(쪽마다 고해상도 캔버스를 인쇄 전용 DOM에 넣기)는 두지 않는다. 인쇄 품질(벡터 글자)과 결과가 PDF와 같아야 해서다.

### 5.4 서버 실행 (08 §6)

`PagePainter`와 PDF 작성기가 DOM에 의존하지 않으므로, 동기화 서버(또는 `@quire/server`)가 정본 JSON → 조판 → PDF를 낼 수 있다. 글꼴은 서버가 같은 파일을 읽는다. 첫 쪽 PNG 썸네일은 5단계 밖이다 (래스터라이저가 필요하다).

## 6. 교환 포맷 (G5)

### 6.1 주요 요소 표

"주요 요소 보존"(00 §2)을 시험할 수 있게 정한다. 아래 요소가 왕복 뒤 남아야 한다.

| 요소 | Markdown | HTML | DOCX | HWPX |
|---|---|---|---|---|
| 문단 텍스트, 제목 1–6 | ○ | ○ | ○ | ○ |
| 굵게·기울임·밑줄·취소선 | ○ (밑줄 빼고) | ○ | ○ | ○ |
| 글꼴 크기·색·형광펜 | - | ○ | ○ | ○ |
| 정렬·들여쓰기·줄 간격 | - | ○ | ○ | ○ |
| 목록 (번호·글머리, 수준) | ○ | ○ | ○ | ○ |
| 링크 | ○ | ○ | ○ | ○ |
| 인라인 이미지 | ○ (자산 경로) | ○ (data URL) | ○ | ○ |
| 표 (병합 셀, 열 너비) | ○ (병합·너비 빼고) | ○ | ○ | ○ |
| 구역·용지·여백·방향 | - | - | ○ | ○ |
| 머리말·꼬리말·쪽 번호 | - | - | ○ | ○ |
| 각주 | ○ (GFM 각주) | ○ (끝에 목록) | ○ | ○ |
| 다단 | - | - | ○ | ○ |
| 떠 있는 이미지·어울림 | - | - | ○ | ○ |
| 댓글 | - | - | ○ | ○ (메모) |
| 변경 추적(제안) | - | - | ○ (`w:ins`·`w:del`) | 내보낼 때 최종본 |

"-"인 요소는 내보낼 때 버리거나(쪽 설정) 가까운 것으로 바꾼다(밑줄 → `<u>`). 가져올 때 모르는 요소는 버리고, 버린 요소 수를 결과에 알린다 (`ImportReport`).

### 6.2 구조

- 모든 변환은 **정본 JSON(07 §4)** 을 거친다: 내보내기는 정본 → 포맷, 가져오기는 포맷 → 정본 → `documentFromQuire`. 내보내기의 시작은 `quireFromDocument`다. 편집 모델·Loro를 직접 다루지 않는다.
- 클립보드의 HTML 변환(`fragmentToHtml`·`htmlToFragment`, 04 §6)은 문서 조각용이다. 문서 단위 HTML은 이것을 넓혀 같이 쓴다 (정제 규칙 하나).
- 패키지 `@quire/convert` (DOM 없음). HTML 파싱은 이미 자체 파서(`parseHtml`)가 있어 Node에서도 된다. DOCX·HWPX는 zip + XML이다: zip은 `sync/zip.ts`를 옮겨 같이 쓰고, XML은 작은 자체 파서를 둔다 (네임스페이스, 엔티티, CDATA만).
- 단위: DOCX는 twip(1/20 pt)·EMU, HWPX는 HWPUNIT(1/7200 인치 = 1/100 pt). 정본은 1/1000 pt라 정수 변환이다.

### 6.3 DOCX

- 내보내기: `document.xml`(본문, 표, 구역 `w:sectPr`), `styles.xml`(문단 스타일 → `w:style`), `numbering.xml`(목록), `footnotes.xml`, `header*.xml`·`footer*.xml`, `comments.xml`, `media/`. 제안은 `w:ins`·`w:del`(글자), `w:rPrChange`(서식)로 낸다.
- 가져오기: 같은 부분을 읽는다. 스타일 상속(`w:basedOn`)과 문서 기본값을 풀어 정본의 스타일·직접 서식으로 둔다.
- 글꼴은 이름만 옮긴다. 우리 글꼴 목록에 없으면 기본 글꼴로 조판한다 (쪽 나눔이 Word와 다를 수 있다, 02 O-7).

### 6.4 HWPX

- HWPX(OWPML, KS X 6101)는 zip 안의 `Contents/section*.xml`, `Contents/header.xml`(글꼴·글자 모양·문단 모양 표), `BinData/`다. 글자·문단 모양을 ID로 참조하므로 내보낼 때 서식 조합을 모아 표를 만든다.
- 이전 형식 HWP(바이너리)는 하지 않는다.
- 기준 문서 세트의 "서식 문서"를 HWPX로 내보내 한글에서 열어 쪽 나눔을 비교한다 (02 O-7, 사람 확인).

### 6.5 Markdown

- GFM: 제목, 강조, 목록(중첩), 링크, 이미지, 표, 각주, 코드(코드 스타일 문단 → 펜스). 가져오기 파서는 직접 쓴다 (블록 → 인라인 두 단계, GFM 명세의 일부).

## 7. 플러그인 API (G6)

00 §4의 맨 위 층이다. 편집기 코어를 고치지 않고 기능을 덧붙이는 자리다.

```ts
interface QuirePlugin {
  name: string;
  /** 명령 (editor.run(name, ...args)) */
  commands?: Record<string, (ctx: PluginContext, ...args: unknown[]) => boolean>;
  /** 단축키 → 명령 이름 */
  keymap?: Record<string, string>;
  /** 장식 소스 (§2) */
  decorations?: (ctx: PluginContext) => DecorationSource;
  /** 장식·주석 종류 그리기 (오버레이) */
  painters?: Record<string, OverlayPainter>;
  /** 오른쪽 클릭 메뉴 항목 */
  contextMenu?: (ctx: PluginContext, at: StoryPos) => MenuItem[];
  /** 내보내기 형식 (§6) */
  exporters?: Record<string, Exporter>;
  /** 문서 확장 데이터: 정본 객체의 `x.<name>` (07 §4) */
  data?: { schemaVersion: number; migrate?(old: unknown, from: number): unknown };
  init?(ctx: PluginContext): void | (() => void);
}
```

- `PluginContext`는 편집기의 좁은 면만 준다: 문서 읽기, 트랜잭션 만들기(`ctx.transact(ops)` → 실행 취소·동기화·제안 기록을 그대로 탄다), 선택, 좌표(`caretRect`·`rangeRects`), 장식 다시 그리기 요청.
- 플러그인이 직접 문서 상태를 바꾸는 길은 트랜잭션 하나뿐이다. 그래서 권한(읽기 전용)·제안 모드가 플러그인에도 적용된다.
- 찾기(§3)와 맞춤법(§4)을 내장 플러그인으로 다시 짠다. 그래도 동작이 같으면 API가 충분하다는 증거다 (G6 기준).
- 예제 플러그인: 글자 수 세기(상태 표시, 장식 없음), 강조 낱말(정해진 낱말에 장식 + 명령).
- 플러그인 데이터의 동기화: `x` 데이터는 정본·`.quire`에 남는다. 실시간 동기화는 문서 수준 키 맵(구역 설정과 같은 모양, 12 §3.2)에 `x|<name>|<key>`로 둔다 (5-8에서 필요하면).

## 8. 공개 API 정리 (08)

- 지금 편집기 생성자(`new Editor(opts)`)를 08 §3의 `createEditor`로 감싸고, 플러그인 옵션을 받는다.
- `@quire/react`: `useQuire`, `QuireEditor`, `useEditorState` (08 §4). 입력 한 번이 리렌더를 일으키지 않음을 시험한다 (렌더 횟수 세기).
- 이것은 5단계 끝(5-8)에 플러그인 API와 같이 한다.

## 9. 단계 계획

| 단계 | 내용 | 끝났다는 기준 |
|---|---|---|
| 5-1 | 장식 레이어(§2)와 찾기·바꾸기(§3): 모든 스토리, 옵션, 모두 바꾸기 한 트랜잭션, 찾기 막대 | G1 |
| 5-2 | 맞춤법(§4): 검사기 인터페이스, 내장 검사기 둘, 일정·캐시, 물결 밑줄과 메뉴 | G2 |
| 5-3 | 쪽 그리기 분리(§5.1): `PaintTarget`·`PagePainter`, 편집기가 그것을 씀, 그리기 지문 시험 | G3 (화면 결과 그대로) |
| 5-4 | PDF 내보내기와 인쇄(§5.2–5.4): 글꼴 넣기·ToUnicode·이미지·링크·개요, Node 실행 | G4 |
| 5-5 | 문서 단위 HTML·Markdown 가져오기·내보내기, `@quire/convert`와 주요 요소 시험 틀(§6.1) | G5의 Markdown·HTML 열 |
| 5-6 | DOCX 가져오기·내보내기 | G5의 DOCX 열 |
| 5-7 | HWPX 가져오기·내보내기 | G5의 HWPX 열 |
| 5-8 | 플러그인 API(§7), 찾기·맞춤법을 플러그인으로, 예제 플러그인, `createEditor`·`@quire/react`(§8) | G6 |

- 5-1이 장식 레이어를 만들고 5-2·5-8이 그것을 쓴다. 5-4는 5-3 위에 있다. 5-5가 변환 틀(정본 거치기, 주요 요소 시험)을 만들고 5-6·5-7이 그 위에 포맷만 더한다.
- 5-3은 기능이 늘지 않는 리팩터링이라 앞의 다른 단계와 겹치지 않게 따로 둔다.

## 10. 5단계 밖

- 첫 쪽 PNG 썸네일 (래스터라이저), SSR 읽기 전용 보기 (08 O-19).
- 이전 형식 HWP(바이너리), ODT, RTF.
- 문단마다 언어 속성과 언어별 맞춤법·줄바꿈.
- 바꾸기에서 서식 찾기·서식 바꾸기, 특수 문자(¶, 쪽 나눔) 찾기.
- 번역, 문법 교정 같은 AI 기능 (플러그인으로 앱이 만든다).

## 11. 열린 질문

- O-36. 한국어 기본 맞춤법 검사기: 공개 사전(Hunspell 한국어 사전, 라이선스 MPL·GPL·LGPL 중 선택)을 WASM으로 넣을지, 서버 서비스 어댑터만 둘지. 사전 기반은 띄어쓰기·조사를 잘 못 잡는다. 5-2는 인터페이스와 내장 검사기 둘만 두고 정하지 않는다.
- O-37. PDF 글꼴 부분화: CFF 부분화(글리프 ID를 유지한 채 쓰지 않는 글리프의 CharString을 비우기)를 직접 할지, 조각 파일을 통째로 넣을지. 조각을 통째로 넣으면 한글 문서 PDF가 1–2 MB 커진다. 5-4는 CharString 비우기를 먼저 해 보고, 어려우면 통째로 넣는다.
- O-38. DOCX·HWPX에서 우리에게 없는 요소(글상자, 도형, 수식, 차트)를 가져올 때: 버리기, 그림으로 바꾸기(가져올 때 그림 정보가 있으면), 플러그인 데이터(`x`)로 보존해 내보낼 때 되돌리기. 보존하면 왕복 손실이 줄지만 편집과 어긋날 수 있다.
- O-39. 찾기를 Worker로 옮길지: 1,000쪽은 메인에서 충분할 것으로 보지만 1만 쪽에서 다시 잰다.
