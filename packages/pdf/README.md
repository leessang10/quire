# @quire/pdf

PDF export for Quire documents with embedded, subset fonts (browser or Node).

Part of [Quire](https://github.com/leessang10/quire), a web document editor with canvas rendering and its own typesetting engine (real page layout, precise Korean typesetting, full IME control, large documents, collaboration).

## Install

```sh
npm install @quire/pdf
```

## Usage

Produces a PDF from the editor (`printSource()`) or, without a DOM, from a canonical document with `pdfFromQuire(doc, { fonts, subsetter, asset })`. Fonts are embedded and subset with HarfBuzz.

## License

MIT
