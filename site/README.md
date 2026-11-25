# Quire 소개 페이지

Vercel에 올리는 소개 페이지 (Next.js App Router): https://quire-ten-omega.vercel.app

- `/`·`/en`: 소개, 설치 명령, 실제 편집기 데모, 기능 소개, 예제 앱 갤러리
- `/docs`·`/en/docs`: API 문서 (옵션, 명령, 상태, React, 저장, 변환, PDF, 플러그인, 테마, 언어, 협업)
- `/guide`·`/en/guide`: Next.js 예제 앱을 처음부터 만드는 단계별 가이드
- 한국어는 `app/(ko)`, 영어는 `app/(en)/en`에 있습니다. Tailwind CSS 4와 shadcn/ui(Base UI) 컴포넌트를 공유합니다.

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
