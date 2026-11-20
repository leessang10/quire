# 17. 테마와 스타일 변수

- 상태: 7단계 진행 중 (T-1 토큰·바뀜 감지, T-2 테마 셋 × 라이트·다크, T-4 연속 보기 구현. 클래스·SCSS 공개(T-3)·집중 모드는 나중, §10)
- 범위: 편집기 화면의 모양(크롬과 캔버스 그리기), 테마, 보기 모드, 사용자가 덮어쓸 수 있는 CSS 변수(공개 API).
- 바탕: 04(렌더링·접근성), 08(통합·임베드), 10(서식·스타일), 12(조판, 기준 문서 세트).

## 1. 목표

| # | 목표 | 끝났다는 기준 |
|---|---|---|
| T1 | 화면 모양을 CSS 변수로 바꿀 수 있다 (도구 막대·대화상자와 캔버스 모두) | 변수 하나를 바꾸면 DOM과 캔버스가 같이 바뀐다. 편집기 코드에 색 상수가 남지 않는다 |
| T2 | 테마는 변수 값 묶음이다 | 테마를 바꿔도 레이아웃 지문·쪽 나눔이 그대로 (기준 문서 세트) |
| T3 | 라이트·다크 | 두 모드 모두 대비 WCAG AA, 포커스 링이 보인다 |
| T4 | 임베드하는 쪽이 CSS·SCSS·Tailwind로 덧입힐 수 있다 | 공개 변수·클래스 이름이 문서로 고정되고, 이름을 바꾸려면 판 올림이 필요하다 |

## 2. 두 층: 화면 테마와 문서 모양

**테마는 문서를 바꾸지 않는다.** 이것이 이 문서의 바탕 규칙이다.

| | 화면 테마 (이 문서) | 문서 모양 (10 스타일) |
|---|---|---|
| 무엇 | 책상·쪽 종이·그림자·선택·캐럿·손잡이·나눔 표시·도구 막대·대화상자 | 본문 글꼴·크기, 제목 스타일, 문단·줄 간격, 표 테두리, 여백 |
| 저장 | 안 함 (사용자·앱 설정) | 문서에 저장, 동기화 |
| 레이아웃 영향 | 없음 | 있음 |
| 바꾸는 방법 | CSS 변수, 테마 | 스타일 세트(새 문서 템플릿), 스타일 편집 |

- "Notion 풍 테마로 바꿨더니 쪽 수가 바뀐다"가 생기면 안 된다. 같은 문서는 어느 테마에서나 같은 쪽 나눔이다 (12 §1 기준 문서 세트, 결정성 지문).
- 그래서 글꼴 크기·줄 간격·여백은 CSS 변수로 열지 않는다. 문서 모양을 바꾸고 싶으면 **스타일 세트**(`DEFAULT_STYLES`를 바꿔 끼운 새 문서 템플릿)를 쓴다. 스타일 세트는 이 문서의 범위 밖이고 10에서 다룬다.
- 열어 두는 글꼴은 UI 글꼴(`--quire-font-ui`)뿐이다.

## 3. 테마

테마 = 변수 값 묶음 + 몇 가지 배치 스위치. 이름은 다른 제품 이름을 쓰지 않는다 (상표, 고유 디자인을 베끼지 않음). 분위기만 참고한다.

| 테마 | 분위기 | 쪽 | 도구 막대 |
|---|---|---|---|
| 클래식 (기본) | 쪽 중심 워드프로세서 | 회색 책상, 그림자 있는 흰 쪽 | 위에 고정, 묶음별 |
| 미니멀 | 장식 없는 편집기 라이브러리 | 책상 = 배경, 얇은 테두리 하나 | 기본 단추만 |
| 모던 | 중성 회색·둥근 모서리·얇은 테두리·아이콘 단추 | 얇은 테두리 + 약한 그림자 | 위에 고정, 아이콘 |

- 처음에는 이 셋 × 라이트·다크만 만든다. 다른 테마는 변수 값을 더하는 것으로 충분해야 한다 (코드 변경 없음).
- 배치 스위치는 변수가 아니라 편집기 옵션이다: `toolbar: 'top' | 'floating' | 'none'`, `pageEdge: 'shadow' | 'border' | 'none'`. 값의 모양(색·반경)은 변수가 정한다.

### 3.1 라이트·다크

- 테마와 직교한다. 각 테마가 두 모드를 갖는다. 기본은 `prefers-color-scheme`을 따르고, `data-theme="light" | "dark"`로 고정할 수 있다.
- **다크에서도 쪽은 흰 종이**가 기본이다 (`--quire-page`가 밝음). 문서에 저장된 글자 색(검정 글자 등)을 그대로 그려도 읽힌다.
- 쪽까지 어둡게 하는 "어두운 종이"는 사용자가 `--quire-page`·`--quire-text`를 바꿔 만든다. 문서에 저장된 색은 바꾸지 않고 그대로 그린다 (§9 O-43).

### 3.2 보기 모드

테마와 따로다. 레이아웃은 모두 같고 그리기만 다르다.

- 인쇄 모양: 쪽마다 종이와 틈 (지금).
- 연속: 쪽 틈 없이 쪽 경계에 얇은 선만. 머리말·꼬리말은 흐리게. 쪽 기반이 아닌 편집기처럼 쓰고 싶은 사용자를 위한 것.
- 집중: 도구 막대와 패널을 숨김. 선택하면 떠 있는 서식 막대.

## 4. CSS 변수 (공개 API)

### 4.1 규칙

- 접두사 `--quire-`. 다른 라이브러리·Tailwind 변수와 겹치지 않는다.
- **의미 이름**만 쓴다: `--quire-accent`(O), `--quire-blue`(X). 테마가 바뀌어도 뜻이 같다.
- 두 층:
  - **기본 토큰**: 사용자가 주로 덮어쓴다.
  - **부품 토큰**: 기본 토큰을 참조하는 기본값을 갖는다. 세밀하게 바꿀 때만 쓴다.
  ```css
  .quire {
    --quire-selection: color-mix(in srgb, var(--quire-accent) 25%, transparent);
  }
  ```
- 변수는 편집기 호스트 요소(`.quire`)에 정의한다. 한 페이지에 편집기가 여럿이면 각각 다른 테마를 가질 수 있다.
- 이 목록에 없는 변수는 내부용이다 (`--quire-_` 접두사, 바뀔 수 있다).

### 4.2 기본 토큰

| 변수 | 쓰임 | 클래식 라이트 기본값 |
|---|---|---|
| `--quire-background` | 편집기 바깥 배경 | `#ffffff` |
| `--quire-foreground` | UI 글자 | `#1c1c1e` |
| `--quire-muted` | 흐린 면 (책상, 비활성 단추) | `#e9e9ec` |
| `--quire-muted-foreground` | 보조 글자 (자리표시, 나눔 표시 이름) | `#6b6b72` |
| `--quire-accent` | 강조 (활성 단추, 손잡이, 편집 중 경계) | `#1a73e8` |
| `--quire-accent-foreground` | 강조 위 글자 | `#ffffff` |
| `--quire-border` | 테두리·구분선 | `#d4d4d8` |
| `--quire-ring` | 포커스 링 | `var(--quire-accent)` |
| `--quire-danger` | 오류·위험 | `#d93025` |
| `--quire-radius` | 모서리 반경 | `6px` |
| `--quire-font-ui` | 도구 막대·대화상자 글꼴 (문서 글꼴 아님) | 시스템 산세리프 |

### 4.3 캔버스 부품 토큰

캔버스가 그리는 것. 편집기가 계산된 값을 읽어 그린다 (§5).

| 변수 | 쓰임 | 기본값 |
|---|---|---|
| `--quire-desk` | 쪽 바깥 책상 | `var(--quire-muted)` |
| `--quire-page` | 쪽 종이 | `#ffffff` |
| `--quire-page-shadow` | 쪽 그림자 (`none`이면 없음) | `0 1px 8px rgb(0 0 0 / .12)` |
| `--quire-page-border` | 쪽 테두리 (`none`이면 없음) | `none` |
| `--quire-text` | 색이 지정되지 않은 문서 글자 | `#1c1c1e` |
| `--quire-caret` | 캐럿 | `var(--quire-text)` |
| `--quire-selection` | 선택 (포커스 있음) | 강조 25% |
| `--quire-selection-inactive` | 선택 (포커스 없음) | 흐린 회색 |
| `--quire-preedit` | 한글 조합 중 밑줄 | `var(--quire-text)` |
| `--quire-mark` | 쪽·구역 나눔 점선과 이름 | `var(--quire-muted-foreground)` |
| `--quire-field` | 머리말·꼬리말 편집 중 필드 바탕 | `#e4e4ea` |
| `--quire-grip` / `--quire-grip-active` | 문단 손잡이 | 흐린 회색 / `var(--quire-accent)` |
| `--quire-drop-line` | 끌어 놓기 선 | `var(--quire-accent)` |
| `--quire-table-border` | 테두리가 지정되지 않은 표의 선 | `#c7c7cc` |
| `--quire-placeholder` | 아직 조립하지 않은 영역 자리표시 | 흐린 회색 |
| `--quire-hf-dim` | 본문 편집 중 머리말·꼬리말 불투명도 (0–1) | `0.55` |
| `--quire-body-dim` | 머리말·각주 편집 중 본문 불투명도 (0–1) | `0.4` |
| `--quire-remote-1` … `--quire-remote-8` | 협업 캐럿·선택 팔레트 (프레즌스는 번호 1–8을 준다, §9 O-42) | 테마마다 |

### 4.4 크롬 부품 토큰

| 변수 | 쓰임 |
|---|---|
| `--quire-toolbar-bg`, `--quire-toolbar-border`, `--quire-toolbar-height` | 도구 막대 |
| `--quire-button-bg`, `--quire-button-hover`, `--quire-button-active` | 단추 (`aria-pressed="true"`면 active) |
| `--quire-dialog-bg`, `--quire-dialog-shadow` | 대화상자 |
| `--quire-tooltip-bg`, `--quire-tooltip-fg` | 도움말 |
| `--quire-floating-bg`, `--quire-floating-shadow` | 떠 있는 서식 막대 (집중 모드) |

### 4.5 열지 않는 것

- 문서 글꼴·크기, 줄 간격, 문단 간격, 여백, 쪽 크기: 문서 내용이다 (§2).
- 문서에 저장된 글자 색·형광펜·표 배경: 문서 내용이다 (어두운 종이에서 그리기만 바꾼다, §3.1).
- 캐럿 두께, 손잡이 크기 같은 히트 영역: 접근성과 입력 정확도 때문에 고정 (필요해지면 열린 질문으로).

## 5. 캔버스가 변수를 읽는 방법

- 편집기는 시작할 때와 테마가 바뀔 때 호스트 요소의 `getComputedStyle`에서 §4.3 변수를 읽어 그리기 토큰 객체로 만든다. 지금의 `COLORS` 상수(`editor.ts`)를 이 객체로 바꾼다.
- 캔버스에는 **계산된 색**만 넘긴다. `color-mix()`·`oklch()`·`var()`는 브라우저마다 캔버스 `fillStyle`이 받는 범위가 다르므로, 숨긴 요소의 `color`에 값을 넣고 계산된 `rgb()`를 읽는 방식으로 풀어 쓴다.
- 그림자는 `box-shadow` 문법 하나만 받아 캔버스 `shadowColor`·`shadowBlur`·`shadowOffsetY`로 옮긴다 (여러 겹은 첫 번째만).
- 바뀜 감지 (CSS 변수는 바뀌어도 이벤트가 없다):
  - `prefers-color-scheme` 미디어 쿼리의 `change`.
  - 호스트와 `<html>`의 `class`·`data-theme`·`style` 속성 변경 (`MutationObserver`).
  - 명시적 API `editor.refreshTheme()` (스타일시트를 바꾼 앱이 부른다).
  - 다시 읽은 값이 같으면 다시 그리지 않는다. 레이아웃은 절대 다시 하지 않는다 (T2).
- 접근성 미러(04 §3)와 입력 층은 화면에 보이지 않으므로 테마와 무관하다. 고대비 모드(`forced-colors: active`)에서는 변수 대신 시스템 색(`Canvas`, `CanvasText`, `Highlight`, `HighlightText`)을 읽는다.

## 6. 클래스와 상태 속성 (공개 API)

변수로 안 되는 모양은 클래스로 덮어쓴다. 이 이름들도 공개 API다.

| 선택자 | 무엇 |
|---|---|
| `.quire` | 편집기 호스트 (변수 정의 자리) |
| `.quire-canvas` | 쪽을 그리는 캔버스 |
| `.quire-toolbar`, `.quire-toolbar-group` | 도구 막대와 묶음 |
| `.quire-button`, `.quire-select`, `.quire-input` | 컨트롤 |
| `.quire-dialog`, `.quire-dialog-actions` | 대화상자 |
| `.quire-floating-bar` | 떠 있는 서식 막대 |
| `.quire-panel` | 옆 패널 |

- 상태는 클래스가 아니라 속성으로: `aria-pressed`, `aria-disabled`, `data-state="open" | "closed"`, `data-mode="print" | "continuous" | "focus"`, `data-theme`.
- 편집기가 만드는 DOM은 클래스를 하나 이상 갖고, 스타일은 이 클래스에만 건다 (특이도 낮게: `:where(.quire-button)`). 그래서 사용자 CSS가 `!important` 없이 이긴다.
- 플레이그라운드 도구 막대는 앱 코드이고 공개 API가 아니다. 라이브러리가 기본 도구 막대를 제공할 때 이 이름을 쓴다 (08 임베드).

## 7. 덧입히기 예

**CSS**
```css
.quire {
  --quire-accent: #e11d48;
  --quire-radius: 2px;
  --quire-font-ui: "Pretendard", sans-serif;
}
.quire[data-theme="dark"] { --quire-desk: #18181b; }
```

**Tailwind (shadcn 테마 변수에 잇기)**
```css
.quire {
  --quire-background: var(--background);
  --quire-foreground: var(--foreground);
  --quire-muted: var(--muted);
  --quire-accent: var(--primary);
  --quire-accent-foreground: var(--primary-foreground);
  --quire-border: var(--border);
  --quire-ring: var(--ring);
  --quire-radius: var(--radius);
}
```
- 원하면 `@quire/tailwind` 플러그인으로 변수를 Tailwind 색(`bg-quire-page` 등)으로 노출한다 (선택, 나중).

**SCSS**
- 변수 목록을 `@quire/editor/tokens.scss`의 맵(`$quire-tokens`)과 믹스인(`@include quire.theme($overrides)`)으로 배포한다. 자동 완성과 일괄 덮어쓰기용이고, 결과는 위와 같은 CSS 변수다.

**JS (임베드)**
```ts
new Editor({ host, theme: 'modern', mode: 'print', pageEdge: 'shadow' });
editor.setTheme('minimal');
editor.refreshTheme(); // 앱이 스타일시트를 바꾼 뒤
```

## 8. 단계 계획

| 단계 | 내용 | 끝났다는 기준 |
|---|---|---|
| T-1 | 토큰 객체: `COLORS`를 변수 읽기로, 기본값은 지금 색 그대로. 바뀜 감지와 `refreshTheme()` | 화면이 지금과 픽셀 같음, 지문 그대로 (T1·T2) |
| T-2 | 클래식·미니멀·모던 × 라이트·다크 변수 값, `setTheme`, 고대비 모드 | 테마마다 대비 검사 통과, 기준 문서 지문 그대로 (T2·T3) |
| T-3 | 공개 이름 고정: 변수·클래스 표, `tokens.scss`, 예제 | 문서와 타입(`QuireThemeTokens`)이 같은 목록, 이름 변경 검사 시험 (T4) |
| T-4 | 보기 모드: 연속·집중, 떠 있는 서식 막대 | 모드를 바꿔도 레이아웃 그대로 |
| T-5 | 어두운 종이 예제 테마 (변수 값만, 문서 색은 그대로) | 지문 그대로 |

- T-1은 작은 정리 작업이라 3단계(조판) 중에도 할 수 있다. 나머지는 조판이 끝난 뒤 편집기 다듬기 단계(06)에서 한다.

## 9. 열린 질문과 결정

공통 원칙: **색 대비는 스타일을 정한 사람이 판단한다.** 편집기는 테마·사용자 색을 자동으로 보정하지 않는다. 기본으로 제공하는 테마(§3)만 대비를 검사해 내보낸다 (T3).

- O-41. 변수를 호스트(`.quire`)에만 둘지, `:root`에서도 읽을지.
  - **결정**: 호스트에서 읽고, 호스트에 없으면 상속으로 `:root` 값을 쓴다 (CSS 기본 동작). 한 페이지의 편집기마다 테마가 다를 수 있고, 앱 전체 테마와도 이어진다.
- O-42. 협업 캐럿·선택 색.
  - **결정**: 팔레트는 `--quire-remote-1` … `--quire-remote-8` 여덟 가지로 고정한다. 프레즌스는 사용자에게 색 값이 아니라 **팔레트 번호(1–8)**를 준다. 그래서 테마를 바꾸면 협업 색도 테마를 따른다. 대비 보정은 하지 않는다.
- O-43. 어두운 종이에서 문서 색.
  - **결정**: 종이는 기본 흰 바탕(`--quire-page`)에 지정되지 않은 글자는 검정(`--quire-text`)이다. 다크 모드에서도 이 기본은 그대로다. 사용자가 두 변수를 바꿔 어두운 종이를 만들 수 있다.
  - 문서에 저장된 색(글자 색·형광펜·표 배경)과 이미지는 바꾸지 않고 그대로 그린다. 어두운 종이에서 읽기 어려운 색이 생겨도 스타일을 정한 사람의 몫이다. 그래서 §3.1의 "그리기만 문서 색을 바꾸는 규칙"은 두지 않는다.
- O-44. 쪽 그림자 그리기.
  - **결정**: 성능 우선. 그림자는 쪽 크기마다 한 번 미리 그린 이미지(오프스크린 캔버스)를 붙여 그리고, 변수(`--quire-page-shadow`)나 쪽 크기가 바뀔 때만 다시 만든다. 매 프레임 캔버스 그림자 효과를 쓰지 않는다. 겹친 그림자는 첫 번째만 쓴다 (§5).
- O-45. 공개 변수 이름을 나중에 바꾸거나 지울 때의 정책.
  - 질문의 뜻: 이 문서의 변수·클래스 이름은 사용자 CSS가 직접 쓰는 약속이다. 예를 들어 다음 판에서 `--quire-mark`를 `--quire-break-mark`로 바꾸면, 옛 이름으로 색을 바꿔 둔 사용자의 화면은 아무 오류 없이 기본색으로 돌아간다. 이때 (가) 바로 옛 이름을 끊을지, (나) 한 판 동안 옛 이름도 읽어 주고 개발자 콘솔에 "새 이름을 쓰라"는 경고를 낼지를 정한다.
  - **결정**: (나). 이름을 바꾸면 한 판 동안 옛 이름도 읽고(새 이름이 있으면 새 이름이 이긴다) 개발자 콘솔에 한 번 경고를 낸다. 다음 판에서 옛 이름을 지운다. 바뀐 이름은 변경 기록에 적는다.

## 10. 7단계 구현 (2026-11-20)

- `@quire/editor` `theme.ts`: 변수 목록(`THEME_TOKENS`, 기본값은 테마를 넣기 전 화면 색 그대로), 기본 테마 스타일시트(`THEME_CSS`, `:where`로 특이도 0 → 앱 CSS가 이긴다), 읽기(`readThemeColors`: 숨긴 요소의 `color`로 `rgb()`로 풀어 씀), 그림자 문법 한 겹 읽기.
- 편집기 옵션 `theme`(classic·minimal·modern), `colorScheme`(light·dark·auto), `pageView`(print·continuous). API `setTheme`, `setColorScheme`, `setPageView`, `refreshTheme`, `appearance`. 호스트에 `.quire`와 `data-quire-theme`·`data-quire-scheme`·`data-quire-page-view`.
- 바뀜 감지: 호스트와 `<html>`의 `class`·`style`·`data-theme`·`data-quire-*` (`MutationObserver`), 시스템 다크 모드 (`auto`일 때). 다시 읽은 값이 같으면 다시 그리지 않고, 레이아웃은 다시 하지 않는다.
- 쪽 그리기기(`PagePainter`)는 `env.colors`로 색을 받는다. PDF는 받지 않아 늘 기본 색이다 (문서 그대로).
- **설계와 다르게 한 것**: 기본 `colorScheme`는 `light`다 (§3.1은 시스템을 따름). 앱 화면이 밝은데 편집기 책상만 어두워지는 일을 막는다. 시스템을 따르려면 `auto`.
- **연속 보기**: 책상도 종이 색으로 칠하고 쪽 그림자·테두리를 그리지 않는다. 쪽 틈은 레이아웃 그대로 남는다 (빈 종이로 보인다). 쪽 경계선은 그리지 않는다.
- 주석 범위 색(댓글·고른 주석)은 변수로 열지 않았다 (나중).
- 나중: 클래스 이름 고정과 `tokens.scss`(T-3), 집중 모드·떠 있는 서식 막대(T-4 일부: 예제 앱이 앱 쪽에서 만든다), 어두운 종이 예제(T-5), 고대비 모드, 협업 팔레트 변수.
- **스타일 예제** (Next.js + Tailwind + shadcn/ui): 같은 편집기를 Google Docs식(`examples/next-shadcn`)·Word식(`examples/next-word`: 리본, 클래식·인쇄 모양)·Notion식(`examples/next-notion`: 미니멀·연속 보기, `/` 메뉴, 떠 있는 서식 막대)으로 꾸민다. Notion식의 어두운 화면은 앱 CSS가 `.dark .quire { --quire-page; --quire-text … }`를 덮어써 문서 면까지 어둡게 한다 (T-5 "어두운 종이"를 예제로).
- 앱 명령용 공개 API를 더했다: `replaceRange(from, to, text)`, `insertText(text)` (Notion식 `/` 메뉴가 "/찾을 말"을 지울 때).

