# 엔진 글꼴

엔진이 직접 불러와 셰이핑(HarfBuzz)과 그리기(`FontFace`)에 함께 쓰는 글꼴이다 (ADR-0002). 시스템 글꼴에 기대지 않아야 기기마다 같은 쪽 나눔이 나온다 (02 R1).

| 글꼴 | 파일 | 판 | 출처 | 라이선스 | 역할 |
|---|---|---|---|---|---|
| Pretendard | `pretendard/Pretendard-Regular.otf` (1.57 MB) | v1.3.9 | github.com/orioncactus/pretendard (`packages/pretendard/dist/public/static`) | SIL OFL 1.1 (`pretendard/LICENSE.txt`) | 기본 본문 |
| Pretendard Bold | `pretendard/Pretendard-Bold.otf` (1.58 MB) | v1.3.9 | 위와 같음 | 위와 같음 | 굵게 (10 §4) |
| Noto Sans KR | `noto-sans-kr/NotoSansKR-Regular.otf` (4.64 MB) | Sans2.004 | github.com/notofonts/noto-cjk (`Sans/SubsetOTF/KR`) | SIL OFL 1.1 (`noto-sans-kr/LICENSE.txt`) | 대체 (Pretendard에 없는 글자: 한자, 옛한글 자모 등) |

- HarfBuzz(harfbuzzjs)가 woff2를 읽지 못하므로 압축 안 된 OTF를 둔다.
- 배포·개발 서버에는 원본이 아니라 **조각**을 둔다: `npm run fonts`(`node scripts/build-fonts.mjs`)가 유니코드 범위별로 잘라 `apps/playground/public/fonts/<id>/`에 조각과 `manifest.json`을 만든다 (생성물, gitignore). 편집기는 문서에 나온 글자가 든 조각만 내려받는다.

| 글꼴 | 조각 |
|---|---|
| Pretendard (1.72 MB) | `base` 461 KB (라틴, 문장부호, 기호, 호환 자모, 전각, KS X 1001 한글 2,350자), `hangul-1`–`4` 각 250 KB 안팎 (나머지 한글 음절), `other` 221 KB |
| Pretendard Bold (1.71 MB) | 보통 굵기와 같은 조각 (조각 이름으로 짝, 굵은 글자가 나오면 받음) |
| Noto Sans KR (2.93 MB, Pretendard에 없는 글자만) | `hanja-1`–`4` (KS X 1001 한자 4,888자), `hanja-x1`–`x3` (그 밖의 한자), `other` 492 KB |

기울임꼴은 넣지 않는다: 기울임은 바로 선 글꼴을 기울여 그린다 (10 §4). 굵은 얼굴이 없는 대체 글꼴(Noto Sans KR)은 합성 굵게로 그린다.
