# 07. 파일 포맷

- 상태: 초안
- 관련 결정: ADR-0004

## 1. 저장 층

| 층 | 용도 | 포맷 | 정본 여부 |
|---|---|---|---|
| A. 내부 저장 | 서버 DB, 실시간 동기화, 오프라인 캐시 | CRDT 바이너리 (스냅샷 + 업데이트 로그) | 서비스 안에서의 정본 |
| B. 문서 파일 `.quire` | 다운로드, 백업, 다른 환경에서 열기 | ZIP 컨테이너 + JSON | 파일로서의 정본 |
| C. 교환 포맷 | 다른 프로그램과 주고받기 | DOCX, HWPX, PDF, Markdown, HTML | 정본 아님 (손실 가능) |

A ↔ B는 손실 없이 왕복할 수 있어야 한다 (이력 제외 시 `crdt.bin` 없이도 내용은 동일).

## 2. `.quire` 컨테이너

```
report.quire  (ZIP)
├─ mimetype                  "application/vnd.quire" — 압축하지 않은 첫 항목
├─ manifest.json             포맷 버전, 스키마 버전, 생성 엔진 버전, 파일 목록과 해시
├─ document.json             현재 문서 상태 (QuireDoc) — 정본
├─ assets/                   이미지 등 원본 리소스 (파일명 = 내용 해시)
├─ fonts/                    포함 글꼴 (라이선스가 허용할 때만, 서브셋)
├─ history/crdt.bin          (선택) CRDT 스냅샷 — 이력, 원소 ID, 협업 연속성
└─ preview/
   ├─ thumbnail.png          첫 쪽 미리보기
   └─ index.html             (선택) 읽기 전용 미리보기. 열 때는 무시
```

### manifest.json

```json
{
  "format": "quire",
  "formatVersion": 1,
  "schemaVersion": 1,
  "generator": "quire-engine/0.1.0",
  "files": {
    "document.json": { "sha256": "…" },
    "history/crdt.bin": { "sha256": "…", "stateHash": "…" }
  },
  "fonts": [
    { "family": "Pretendard", "embedded": "fonts/pretendard-sub.woff2", "metricsHash": "…" },
    { "family": "상용글꼴", "embedded": null, "metricsHash": "…" }
  ]
}
```

## 3. 여는 규칙

1. `mimetype`, `manifest.json`을 확인한다. `formatVersion`이 엔진보다 높으면 **읽기 전용**으로 연다.
2. `document.json`을 읽고 스키마 검증 → 필요하면 마이그레이션(§6).
3. `history/crdt.bin`이 있고, 그 현재 상태 해시(`stateHash`)가 `document.json`의 정규화 해시와 같으면 CRDT 상태로 연다 (이력 유지).
   다르면 `crdt.bin`을 버리고 `document.json`에서 새 CRDT 상태를 만든다 (이력 없음). 외부 도구가 JSON만 수정한 경우를 위한 규칙이다.
4. 포함되지 않은 글꼴은 대체 글꼴로 조판하고 사용자에게 알린다. `metricsHash`가 다른 같은 이름의 글꼴도 "다른 글꼴"로 본다 (쪽 나눔이 달라질 수 있음).

## 4. document.json (QuireDoc v1)

내부 모델은 `¶`로 끝나는 평평한 원소 열(01 §2)이지만, 파일에서는 읽기 쉽게 **문단 배열**로 펼친다. 문단은 항상 `¶`로 끝나므로 양방향 변환은 손실이 없다.

```json
{
  "format": "quire",
  "version": 1,
  "settings": { "defaultStyle": "Normal", "koreanBreak": "word" },
  "styles": {
    "Normal":   { "font": "Pretendard", "size": 10000 },
    "Heading1": { "basedOn": "Normal", "size": 18000, "bold": true }
  },
  "sections": [
    { "id": "s1", "page": { "width": 595276, "height": 841890, "margin": [72000, 72000, 72000, 72000] },
      "columns": 1, "header": "hdr1" }
  ],
  "stories": {
    "body": [
      { "p": { "style": "Heading1" }, "c": [ { "t": "1. 서론" } ] },
      { "p": { "align": "justify" }, "c": [
          { "t": "본문은 " },
          { "t": "굵게", "m": { "bold": true } },
          { "t": " 쓴다." },
          { "footnote": "fn1" }
      ] },
      { "table": { "cols": [200000, 200000], "rows": [ { "cells": [ { "story": "cell1" }, { "story": "cell2" } ] } ] } }
    ],
    "hdr1":  [ { "p": {}, "c": [ { "field": "pageNumber" } ] } ],
    "fn1":   [ { "p": {}, "c": [ { "t": "각주 내용." } ] } ],
    "cell1": [ { "p": {}, "c": [ { "t": "A" } ] } ],
    "cell2": [ { "p": {}, "c": [ { "t": "B" } ] } ]
  },
  "annotations": [
    { "id": "a1", "type": "comment",
      "start": { "story": "body", "offset": 3 }, "end": { "story": "body", "offset": 14 },
      "data": { "thread": "t1" } }
  ],
  "x": { }
}
```

### 규칙

- 길이 단위: 정수 1/1000pt (02 §2).
- 오프셋: 스토리 안의 **유니코드 코드포인트** 단위. `¶`, 인라인 개체(각주 참조, 필드, 인라인 이미지), 블록 개체(표)는 각각 1칸.
- 위치에 원소 ID를 쓰지 않는다. ID는 CRDT 내부 개념이며 `crdt.bin`에만 존재한다.
- 연속된 같은 서식 텍스트는 하나의 `t` 런으로 합친다 (정규화 형태). 같은 문서는 항상 같은 JSON 바이트열로 직렬화된다 (키 순서 고정) → 해시 비교와 git diff가 안정적이다.
- 모르는 속성은 지우지 않고 보존한다. 플러그인 데이터는 각 객체의 `x` 필드에 네임스페이스(`"x": {"myplugin": {...}}`)로 넣는다.

## 5. 교환 포맷

| 포맷 | 방향 | 용도 | 손실 |
|---|---|---|---|
| Markdown (GFM) | 가져오기·내보내기 | AI 입력, 개발 문서, 블로그 | 쪽 설정, 색, 정렬, 병합 셀, 댓글 |
| HTML | 가져오기·내보내기 | 웹 게시, 붙여넣기 | 쪽 설정, 겹치는 주석 |
| PDF | 내보내기 | 인쇄, 배포 — 레이아웃 트리 재사용으로 화면과 동일 | 편집 불가 |
| DOCX | 가져오기·내보내기 | Word 호환 | 주요 요소 보존 목표 |
| HWPX | 가져오기·내보내기 | 한글 호환 | 주요 요소 보존 목표 |

## 6. 버전과 마이그레이션

- `version`(스키마)을 올릴 때마다 `vN → vN+1` 변환 함수를 하나씩 추가한다. 여러 단계는 연쇄 적용한다.
- 마이그레이션은 순수 함수이며, 각 버전의 픽스처 파일로 테스트한다.
- 하위 버전으로 저장(다운그레이드)은 지원하지 않는다.

## 7. 열린 질문

- O-16. 상용 글꼴을 포함할 수 없을 때, 쪽 나눔 재현을 위해 글꼴 메트릭만이라도 포함할지 (라이선스 검토 필요).
- O-17. 큰 이미지가 많은 문서의 `.quire` 용량 정책 (원본 유지 vs 최대 해상도 제한).
