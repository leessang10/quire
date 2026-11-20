# Node 변환기 (DOM 없음)

브라우저 없이 Node에서 문서를 바꾸는 명령줄 도구입니다. 모든 변환은 정본(QuireDoc)을 거치고, PDF는 편집기와 같은 조판으로 쪽을 나눕니다 (`@quire/pdf`의 `pdfFromQuire`).

| 입력 | 출력 |
|---|---|
| `.hwpx` `.docx` `.md` `.html` | `.pdf` `.hwpx` `.docx` `.md` `.html` |

## 실행

```bash
node scripts/build-packages.mjs   # 저장소 루트에서 먼저

cd examples/node
npm install
node convert.mjs sample.md out/sample.pdf
node convert.mjs some.hwpx out/some.docx
npm run demo                      # sample.md → PDF·HWPX·DOCX, HWPX → Markdown 왕복
```

실제 출력 (이 저장소의 [`sample.md`](sample.md)):

```text
$ node convert.mjs sample.md out/sample.pdf
가져옴: sample.md (문단 10개)
PDF: 1쪽, 글꼴 2개, 이미지 0개
저장: out/sample.pdf (38.1 KB, 872 ms)

$ node convert.mjs sample.md out/sample.hwpx
가져옴: sample.md (문단 10개)
저장: out/sample.hwpx (7.2 KB, 164 ms)

$ node convert.mjs out/sample.hwpx out/roundtrip.md
가져옴: out/sample.hwpx (문단 10개)
저장: out/roundtrip.md (0.3 KB, 159 ms)
```

가져오며 담지 못한 요소(도형, 수식 등)가 있으면 "버림: …"으로 알립니다.

## 핵심 코드

```js
import { importHwpx, importMarkdown, exportDocx } from '@quire/convert';
import { loadSubsetter, pdfFromQuire } from '@quire/pdf';

const { doc, assets, report } = await importHwpx(bytes);       // → 정본 + 그림 바이트 + 버린 요소
const docx = await exportDocx(doc, { asset: (id) => assets.get(id) });

// PDF: 글꼴 파일(바이트)과 hb-subset WASM을 넘기면 DOM 없이 조판해 쓴다
const pdf = await pdfFromQuire(doc, {
  fonts: [{ name: 'Pretendard', bytes: regular, bold: boldBytes }, { name: 'Noto Sans KR', bytes: noto }],
  subsetter: await loadSubsetter(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'))),
  asset: (id) => assets.get(id),
});
```

[`convert.mjs`](convert.mjs)는 `@quire/fonts`의 글꼴 조각 목록(manifest)에서 PDF용 글꼴을 모읍니다.
