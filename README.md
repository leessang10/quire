# Quire

캔버스 렌더링과 자체 조판 엔진을 갖춘 웹 문서 에디터.

`contenteditable` 기반 에디터(ProseMirror, Lexical, Slate 등)가 구조적으로 해결할 수 없는 문제
— 진짜 페이지 레이아웃, 정밀한 한글 조판, IME 완전 제어, 초대형 문서, 블록 이동까지 포함한 협업 —
를 처음부터 다른 구조로 풀기 위한 프로젝트입니다.

> 상태: **6단계 (출시 준비·안정화)** — 1–5단계 완료, 6단계는 6-1–6-6 완료·6-7(실제 환경 확인) 남음 ([로드맵](docs/design/06-roadmap.md)). 0단계 결과: [편집기·성능](docs/spikes/phase0-baseline.md), [동기화(CRDT) 비교](docs/spikes/phase0-crdt.md)

## 실행

```bash
npm install
npm run dev     # 플레이그라운드 http://localhost:5173
npm test        # 단위 테스트
npm run bench   # 엔진 벤치마크 (모델 + 레이아웃, DOM 없음)
npm run typecheck
npm run fonts && npm run bench:browser  # 1,000쪽 성능 다섯 지표 (헤드리스 Chrome, bench/baseline.json과 비교)
npm run golden  # 기준 문서 레이아웃이 브라우저에서도 같은지 (헤드리스 Chrome·Edge)
node scripts/build-packages.mjs  # @quire/* 패키지 빌드 (.build/packs) → examples/의 예제 앱 6개
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
| [08. 앱 통합](docs/design/08-integration.md) | `createEditor`, React 래퍼, Next.js·Vue·SvelteKit, 서버(Node) 실행 |
| [09. CRDT 통합](docs/design/09-crdt-integration.md) | Loro 위의 문서, Worker·중계 서버, 저장, 새 판 |
| [10. 서식](docs/design/10-formatting.md) | 2단계: 글자·문단 서식, 스타일, 목록 |
| [11. 블록](docs/design/11-blocks.md) | 2단계: 이미지, 어울림, 여러 스토리, 표, 다중 커서 |
| [12. 고급 조판](docs/design/12-advanced-typesetting.md) | 3단계: 구역, 쪽 나눔 제어, 머리말·꼬리말, 각주, 다단, 표 쪽 분할, 한글 조판 |
| [14. 협업과 이력](docs/design/14-collaboration-history.md) | 4단계: 주석, 댓글, 변경 추적, 버전, 권한 |
| [15. 생태계](docs/design/15-ecosystem.md) | 5단계: 찾기, 맞춤법, PDF, HTML·Markdown·DOCX·HWPX, 플러그인·SDK |
| [16. 출시 준비](docs/design/16-release.md) | 6단계: CI, 성능 벤치마크, 레이아웃 골든, 보안, 남은 일 분류, 패키지·예제 앱 |
| [예제 앱](examples/README.md) | 기본: 바닐라, React+Tailwind, Next.js, Vue, SvelteKit, Node 변환기 · 전체 기능: React(Tailwind), Next.js(shadcn/ui) |
| [ADR](docs/adr/) | 아키텍처 결정 기록 |
