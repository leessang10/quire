# @quiredoc/core

Website, live demo and a step-by-step guide: https://quire-ten-omega.vercel.app

Quire core: a web document editor that draws pages on a canvas with its own typesetting engine — real page layout, precise Korean typesetting, full IME control, large documents.

This package is everything the editor needs to run on its own: the document model, the layout engine, HarfBuzz text shaping, the editor, `createEditor`, and saving/loading (canonical JSON and `.quire` files). Optional features are separate packages you add when you need them:

| Package | Adds |
|---|---|
| `@quiredoc/react` | React bindings (`useQuire`, `QuireEditor`) |
| `@quiredoc/collab` | Real-time collaboration, presence, version history (Loro CRDT) |
| `@quiredoc/convert` | HWPX, DOCX, Markdown, HTML import/export |
| `@quiredoc/pdf` | PDF export with embedded subset fonts |
| `@quiredoc/fonts` | Pretendard and Noto Sans KR font chunks |

## Install

```sh
npm install @quiredoc/core @quiredoc/fonts
```

## Usage

```ts
import { createEditor } from '@quiredoc/core';

const editor = await createEditor({ host: document.getElementById('editor')!, fonts });
editor.run('toggleBold');
const saved = editor.toJSON(); // canonical document (QuireDoc)
```

- Serve the font chunks from `@quiredoc/fonts` and point `fonts` at their manifests (see the examples in the repository).
- English UI text loads on demand; import `@quiredoc/core/i18n/en` to have it from the first paint.
- Theme variables for SCSS: `@use 'pkg:@quiredoc/core/tokens.scss' as quire;`

## License

MIT
