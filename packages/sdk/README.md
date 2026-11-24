# @quiredoc/sdk

Quire: canvas-based Korean-first document editor — one-call setup (createEditor), commands, state and file I/O.

Part of [Quire](https://github.com/leessang10/quire), a web document editor with canvas rendering and its own typesetting engine (real page layout, precise Korean typesetting, full IME control, large documents, collaboration).

## Install

```sh
npm install @quiredoc/sdk
```

## Usage

The recommended entry point. `createEditor` mounts a full editor (layout engine, input, fonts, plugins) on an element and returns a handle with commands, an immutable state snapshot, subscriptions and document I/O.

```ts
import { createEditor } from '@quiredoc/sdk';

const handle = await createEditor({ host: document.getElementById('editor')!, fonts });
handle.run('toggleBold');
handle.subscribe(() => console.log(handle.getState()));
const doc = handle.toJSON(); // canonical document (QuireDoc)
```

Fonts (`@quiredoc/fonts`) and the PDF subsetter WASM must be served by your app — see the examples.

## License

MIT
