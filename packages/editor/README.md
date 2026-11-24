# @quire/editor

Quire editor core: canvas rendering, Korean IME input (EditContext), selection, tables, comments, suggestions, themes, i18n.

Part of [Quire](https://github.com/leessang10/quire), a web document editor with canvas rendering and its own typesetting engine (real page layout, precise Korean typesetting, full IME control, large documents, collaboration).

## Install

```sh
npm install @quire/editor
```

## Usage

The `Editor` class: draws pages on a canvas with its own layout engine, handles input through EditContext (or a hidden textarea), keeps an accessibility mirror, and exposes formatting, tables, images, comments, suggestion mode, find & replace, spell-check hooks, themes (`--quire-*` CSS variables), zoom and UI languages (ko built in, en loaded on demand).

Most apps should start from `@quire/sdk` or `@quire/react`. Theme tokens for SCSS: `@use 'pkg:@quire/editor/tokens.scss' as quire;`.

## License

MIT
