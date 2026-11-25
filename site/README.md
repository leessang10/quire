# Quire 소개 페이지

Vercel에 올리는 소개 페이지 (Next.js App Router): https://quire-ten-omega.vercel.app

- `/`: 소개, 실제 편집기 데모(열기·HWPX·DOCX·Markdown·PDF 저장), 설치, 문서 링크
- `/guide`: Next.js 예제 앱을 처음부터 만드는 단계별 가이드

저장소 워크스페이스 밖에 두어 **npm에 올라간 `@quiredoc/*` 판**을 그대로 쓴다. 사용자가 설치하는 것과 같은 판이 데모에서 돈다. 새 판을 낸 뒤에는 `npm install @quiredoc/core@latest …`로 올린다.

## 로컬

```sh
cd site
npm install        # postinstall이 글꼴과 harfbuzz WASM을 public/quire에 복사
npm run dev        # http://localhost:5310
npm run build
```

## Vercel 설정

- Import: GitHub `leessang10/quire`
- **Root Directory: `site`** (Framework는 Next.js로 알아본다)
- 나머지는 기본값. `vercel.json`의 `ignoreCommand`가 `site/`가 바뀐 커밋만 빌드한다.
