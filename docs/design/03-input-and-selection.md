# 03. 입력과 선택

- 상태: 설계 (1–6단계에서 구현함. 구현하며 바뀐 점과 결과는 09–16의 결과 절에 있다)
- 해결 대상: L3, L4

## 1. 요구사항

- R1. 한글 IME 조합 입력이 Chrome, Edge, Safari, Firefox (Windows, macOS)와 iOS Safari, Android Chrome(Gboard, 삼성 키보드)에서 정상 동작한다.
- R2. IME 후보 창이 캐럿 위치에 뜬다.
- R3. 조합 중 캐럿 이동, 마우스 클릭, 원격 편집 도착 같은 방해 상황에서 글자가 중복되거나 사라지지 않는다.
- R4. 선택은 다중 범위, 사각형(표 셀·열) 선택, 블록 선택을 지원한다.
- R5. 키 입력은 모두 명령으로 변환되어 키맵으로 재정의할 수 있다.

## 2. 입력 층 구조

`contenteditable`을 쓰지 않는다. 대신 화면에 보이지 않는 입력 대상을 캐럿 위치에 둔다.

| 경로 | 대상 브라우저 | 방식 |
|---|---|---|
| A. EditContext | EditContext API를 지원하는 브라우저 (현재 Chromium 계열) | 캔버스 요소에 EditContext를 연결. 텍스트 갱신, 조합 범위, 문자 경계를 직접 주고받음 |
| B. 숨긴 textarea | 그 외 (Safari, Firefox, 모바일) | 투명 textarea를 캐럿 위치에 배치하고 `beforeinput`, `input`, `composition*` 이벤트를 해석 |

공통 인터페이스:

```ts
interface InputBackend {
  attach(host: HTMLElement): void;
  setCaretRect(rect: DOMRect): void;          // 후보 창 위치
  setSurroundingText(text: string, selStart: number, selEnd: number): void;
  onIntent: (intent: InputIntent) => void;    // 아래 §3
  cancelComposition(): void;
}
```

### 경로 A 구현 (0단계, `packages/editor/src/edit-context.ts`)

- 편집기 옵션 `input`: `auto`(기본, EditContext가 있으면 A) · `editcontext` · `textarea`. 플레이그라운드는 `?input=`과 상태 패널의 선택 상자로 고른다.
- 보이지 않는 `div`(role=textbox)에 EditContext를 붙이고 캐럿 위치에 둔다. 후보 창 위치는 `updateSelectionBounds`, `updateCharacterBounds`(글자마다 캐럿 사각형), `updateControlBounds`(스크롤 영역)로 알린다.
- **버퍼 = 캐럿이 있는 문단** (`InputBackend.sync`). 편집기가 캐럿을 그릴 때마다(조합 중 제외) 문단 텍스트와 선택을 맞추고, 바뀐 것만 EditContext에 알린다. 버퍼 위치(UTF-16)는 문단 첫 글자의 화면 오프셋 + 코드포인트 수로 문서 위치가 된다.
  - 처음 구현은 textarea처럼 확정할 때마다 버퍼를 비웠다. 실제 Windows 한국어 IME에서 **한자 변환이 되지 않았다**: 한자 키를 누르면 IME가 조합을 먼저 확정하고(`compositionend`), 확정된 글자를 버퍼에서 다시 조합해 바꾸는데, 버퍼가 비어 있어 바꿀 글자가 없었다.
- `textupdate`
  - 조합 중이 아니면 버퍼의 [start, end)를 text로 바꾸는 `replaceText`(보통은 캐럿에 입력, 자동 수정이면 앞 글자 교체).
  - 조합의 첫 `textupdate`가 덮는 범위 = 조합이 가져가는 기존 글자(선택 영역, 한자 재변환 대상) → `compositionStart(replace)`. 편집기는 그 범위를 지우고 조합을 시작한다. 조합 중 글자는 `compositionUpdate`(문서에 넣지 않음)이고, 확정 글자는 이벤트 data(없으면 마지막 preedit)다.
- **조합 중 Enter가 두 번 오는 IME**: Windows 한국어 IME + Chromium은 조합을 확정하는 Enter를 keydown(`Process`, 229) → `compositionend` → keydown(`Enter`, 13)으로 보낸다 (체크리스트로 찾음). 첫 번째로 확정 뒤 문단을 나누고, 같은 누름의 두 번째 keydown(keyup 전, 반복 아님)은 버린다.
- **Enter는 `textupdate`가 오지 않는다** (MDN EditContext 안내). keydown에서 `insertParagraph`로 바꾸고 preventDefault한다. 조합 중 Enter는 key가 `Process`(keyCode 229)일 수 있어 `code`로 알아보고, 조합이 확정된 뒤 문단을 나눈다.
- Backspace·Delete·방향키·단축키는 경로 B와 같이 keydown → `key` 의도로 편집기가 처리하고 preventDefault한다. EditContext 버퍼가 따로 지워지지 않는다.
- 한계: 버퍼가 문단 하나라 IME가 문단 밖을 보지 못한다. 글자별 경계를 모두 캐럿 사각형으로 알리므로, 여러 글자 조합(일본어·중국어)의 후보 창은 조합 시작 위치에 붙는다.

### 경로 B의 주변 텍스트 동기화

- 모바일 키보드는 자동 수정·예측을 위해 입력 요소 안의 앞뒤 텍스트를 읽는다. textarea에 **캐럿 주변 문단 일부**를 채워 두고, 사용자가 이동할 때마다 갱신한다.
- 키보드가 textarea 내용을 직접 바꾸면(자동 수정) 이전·이후 내용을 비교(diff)해 `replaceText` 의도로 변환한다.

## 3. 입력 의도 (InputIntent)

입력 층은 브라우저 이벤트를 다음 의도로 정규화한다. 명령 계층은 브라우저를 모른다.

```ts
type InputIntent =
  | { kind: 'insertText'; text: string }
  | { kind: 'replaceText'; range: [number, number]; text: string } // 주변 텍스트 기준
  | { kind: 'compositionStart' }
  | { kind: 'compositionUpdate'; text: string; caret: number }
  | { kind: 'compositionEnd'; text: string }
  | { kind: 'deleteBackward' | 'deleteForward'; unit: 'char' | 'word' | 'line' }
  | { kind: 'insertParagraph' | 'insertLineBreak' }
  | { kind: 'key'; key: string; modifiers: Modifiers }   // 단축키 후보
  | { kind: 'paste' | 'cut' | 'copy'; data?: DataTransfer };
```

## 4. 한글 조합 상태 머신

```
        compositionStart
 Idle ───────────────────▶ Composing
  ▲                          │  compositionUpdate: 조합 문자열 표시만 갱신 (문서 미반영)
  │                          │
  │   compositionEnd(text)   ▼
  └──────────────── Commit: insertText(text) 트랜잭션 1개
```

- **조합 중인 문자열은 문서 모델에 넣지 않는다.** 렌더러가 캐럿 위치에 임시 런(preedit run)으로 그린다. 레이아웃 엔진은 해당 문단을 "preedit 포함" 상태로 임시 레이아웃한다.
  - 장점: 조합 중 원격 편집이 와도 문서와 조합 문자열이 충돌하지 않는다. 실행 취소 이력에 중간 상태가 남지 않는다.
  - 단점: 협업 상대에게 조합 중 글자가 보이지 않는다 (확정 시 보임). Google Docs와 같은 동작이며 수용한다.
- 조합 중 사용자가 클릭하거나 방향키로 이동하면: 현재 조합 문자열을 확정(commit)한 뒤 이동한다. 브라우저별로 이 순서가 다르므로 입력 층이 순서를 보정한다.
- 조합 중 원격 편집이 캐럿 앞에 들어오면: 캐럿 위치는 ID 기반이므로 그대로 유지되고, preedit의 화면 위치만 다시 계산한다.
- 브라우저별 알려진 특이 동작(조합 종료 후 중복 `input`, Safari의 `compositionend` 순서 등)은 **입력 층의 브라우저별 보정 표**로 관리하고, 각 항목에 재현 테스트를 붙인다.

## 5. 선택 모델

```ts
type Selection =
  | { kind: 'text'; ranges: TextRange[]; primary: number }   // 다중 커서·범위
  | { kind: 'block'; blocks: ElementId[] }                    // 문단·개체 단위 선택
  | { kind: 'cells'; table: ElementId; anchor: CellRef; head: CellRef } // 표 사각형
  | { kind: 'object'; object: ElementId };                    // 이미지·글상자 하나

type TextRange = { anchor: Position; head: Position; goalX?: Unit };
```

- 위치가 ID 기반(01 §3)이므로 선택은 원격 편집 후에도 자동으로 유효하다. 범위가 겹치게 되면 병합한다.
- `goalX`: 위·아래 이동 시 유지할 가로 위치.
- 사각형 텍스트 선택(Alt+드래그, 코드 블록용)은 `text` 선택의 여러 범위로 표현한다.

### 좌표 ↔ 위치 변환 (hit-test)

- `positionAt(point)`: 레이아웃 트리(02 §8)를 쪽 → 영역 → 블록 → 줄 → 런 순으로 탐색. 클러스터 매핑으로 글리프 사이의 캐럿 위치를 정한다. 글자 중앙을 기준으로 앞·뒤를 고른다.
- `caretRect(position)`: 반대 방향. 줄 끝 위치는 `side`로 줄 끝/다음 줄 시작을 구분한다.

### 캐럿 이동 규칙

| 키 | 단위 |
|---|---|
| ←/→ | grapheme 단위 (`Intl.Segmenter`) |
| Ctrl/Alt + ←/→ | 단어 단위 (한글은 어절, 조사 분리 여부는 설정) |
| ↑/↓ | `goalX`를 유지한 시각적 줄 이동. 쪽·단·각주 영역 경계를 넘는 이동 규칙 정의 |
| Home/End | 시각적 줄의 시작·끝 |
| PageUp/Down | 화면 높이만큼 |

## 6. 명령과 키맵

- 명령은 `(state, args) → Transaction | null` 순수 함수다. `null`이면 해당 상황에 적용할 수 없다는 뜻이다.
- 키맵은 `키 조합 → 명령 목록`이며, 앞에서부터 처음 적용되는 명령을 실행한다. 플러그인은 키맵에 우선순위를 두고 끼어든다.
- 다중 커서 선택에서는 명령을 각 범위에 적용하고 하나의 트랜잭션으로 묶는다.

## 7. 열린 질문

- O-8. 안드로이드에서 경로 B의 안정성. 0단계에서 실기기로 검증 (06 §2).
- O-9. 조합 중 글자를 협업 상대에게 보여줄 필요가 있는지 (presence 채널로 별도 전송 가능).
- O-10. 마우스 드래그로 쪽을 넘어가는 선택 시 자동 스크롤 속도·방식.
