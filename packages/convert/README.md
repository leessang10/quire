# @quiredoc/convert

Import and export for Quire documents: HWPX, DOCX, Markdown, HTML (no DOM required).

Part of [Quire](https://github.com/leessang10/quire), a web document editor with canvas rendering and its own typesetting engine (real page layout, precise Korean typesetting, full IME control, large documents, collaboration).

Website, live demo and a step-by-step guide: https://quire-ten-omega.vercel.app

## Install

```sh
npm install @quiredoc/convert
```

## Usage

```ts
import { importDocx, exportHwpx } from '@quiredoc/convert';

const { doc, assets, report } = await importDocx(bytes); // report.dropped: unsupported elements by kind
const hwpx = await exportHwpx(doc, { asset: readAsset });
```

Runs in browsers and Node. Unsafe links are stripped on import.

## License

MIT
