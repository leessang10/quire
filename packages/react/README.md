# @quiredoc/react

React bindings for the Quire editor: useQuire, QuireEditor, useEditorState.

Part of [Quire](https://github.com/leessang10/quire), a web document editor with canvas rendering and its own typesetting engine (real page layout, precise Korean typesetting, full IME control, large documents, collaboration).

Website, live demo and a step-by-step guide: https://quire-ten-omega.vercel.app

## Install

```sh
npm install @quiredoc/react
```

## Usage

```tsx
import { QuireEditor, useEditorState, useQuire } from '@quiredoc/react';

function App() {
  const ctl = useQuire({ fonts });
  const canUndo = useEditorState(ctl, (s) => s.canUndo);
  return <QuireEditor editor={ctl} style={{ height: '100vh' }} />;
}
```

Works with React 18+ and StrictMode. Render it client-only in SSR frameworks (e.g. `next/dynamic` with `ssr: false`).

## License

MIT
