# Quire

캔버스 렌더링과 자체 조판 엔진을 갖춘 웹 문서 에디터.

`contenteditable` 기반 에디터(ProseMirror, Lexical, Slate 등)가 구조적으로 해결할 수 없는 문제
— 진짜 페이지 레이아웃, 정밀한 한글 조판, IME 완전 제어, 초대형 문서, 블록 이동까지 포함한 협업 —
를 처음부터 다른 구조로 풀기 위한 프로젝트입니다.

> 상태: **6단계 (출시 준비·안정화)** — 1–5단계 완료 ([로드맵](docs/design/06-roadmap.md)). 0단계 결과: [편집기·성능](docs/spikes/phase0-baseline.md), [동기화(CRDT) 비교](docs/spikes/phase0-crdt.md)

## 실행

```bash
npm install
npm run dev     # 플레이그라운드 http://localhost:5173
npm test        # 단위 테스트
npm run bench   # 엔진 벤치마크 (모델 + 레이아웃, DOM 없음)
npm run typecheck
```

## 문서

| 문서 | 내용 |
|---|---|
| [00. 개요](docs/design/00-overview.md) | 목표, 비목표, 해결할 9가지 한계, 전체 아키텍처 |
| [01. 문서 모델](docs/design/01-document-model.md) | 스토리, 블록, 위치, 범위 레이어, 연산 |
| [02. 레이아웃 엔진](docs/design/02-layout-engine.md) | 셰이핑, 줄바꿈, 쪽 나눔, 증분 레이아웃 |
| [03. 입력과 선택](docs/design/03-input-and-selection.md) | IME, EditContext, 선택 모델, 명령 |
| [04. 렌더링과 접근성](docs/design/04-rendering-and-accessibility.md) | 캔버스 렌더러, 접근성 미러, 찾기, 클립보드 |
| [05. 협업과 이력](docs/design/05-collaboration-and-history.md) | CRDT, 사용자별 실행 취소, 변경 추적, 버전 |
| [06. 로드맵](docs/design/06-roadmap.md) | 단계별 범위, 0단계 검증 기준, 성능 목표, 위험 |
| [07. 파일 포맷](docs/design/07-file-format.md) | 저장 층, `.quire` 컨테이너, `document.json`, 마이그레이션 |
| [08. 앱 통합](docs/design/08-integration.md) | 공개 API, React 래퍼, Next.js, 서버 실행 |
| [10–15](docs/design/) | 서식, 블록, 고급 조판, 협업과 이력, 생태계 (2–5단계 설계와 결과) |
| [16. 출시 준비](docs/design/16-release.md) | 6단계: CI, 성능, 골든, 보안, 패키지 |
| [ADR](docs/adr/) | 아키텍처 결정 기록 |
