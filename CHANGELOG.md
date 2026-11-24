# Changelog

All `@quiredoc/*` packages share one version and are released together. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) (while in 0.x, a minor bump may contain breaking changes; see `docs/design/16-release.md` §10.8).

## [Unreleased]

### Changed (breaking): packages

The ten 0.1.0 packages become one core and optional modules ([design 19](docs/design/19-packages.md)). Install `@quiredoc/core` and add only what you use; modules take `@quiredoc/core` as a peer dependency, so an app has one copy of it.

| 0.1.0 | 0.2.0 |
|---|---|
| `@quiredoc/sdk`, `@quiredoc/editor`, `@quiredoc/model`, `@quiredoc/layout`, `@quiredoc/shaping` | `@quiredoc/core` |
| `@quiredoc/editor/i18n/en`, `@quiredoc/editor/tokens.scss` | `@quiredoc/core/i18n/en`, `@quiredoc/core/tokens.scss` |
| `@quiredoc/sync`: `QuireDoc`, `documentFromQuire`, `quireFromDocument`, `packQuire`, `openQuire`, `assetIdOf`, `readZip`, `writeZip` … | `@quiredoc/core` |
| `@quiredoc/sync`: collaboration, presence, versions, Worker host | `@quiredoc/collab` |
| `@quiredoc/react`, `@quiredoc/convert`, `@quiredoc/pdf`, `@quiredoc/fonts` | same names (they now take `@quiredoc/core` as a peer dependency) |

- Saving and loading no longer pull in the CRDT (Loro, 21 MB installed): an app without collaboration ships none of it. The basic React example's startup JavaScript went from about 5.2 MB to about 0.5 MB.
- `openQuire` returns the history section as unverified bytes (`history`) instead of a verified `crdt`. To use it for collaboration call `restoreHistory(opened)` from `@quiredoc/collab`; to keep it when saving again pass it to `packQuire({ …, history })`.
- `packQuire({ loro })` became `packQuireWithHistory({ loro })` in `@quiredoc/collab`. `displayText` is in `@quiredoc/collab`.
- The shaping layer's `FontMetrics` is renamed `ShapingFontMetrics` (it clashed with the editor's `FontMetrics`, a different type, once both live in core).

### Added

- `collab(options)` in `@quiredoc/collab`: real-time collaboration as one plugin — `editor.use(collab({ worker, url, user }))` or `createEditor({ plugins: [collab(...)] })`. It connects, puts the shared document into the editor, keeps remote edits, carets, permissions and new epochs in step, and sends your selection. Read-only until connected; detaching closes the connection.
- `PluginContext.sync` (`setDocument`, `documentChanged`, `setRemoteCarets`, `setAccess`) for plugins whose document changes outside the editor, and `page` in `PluginContext.selection()` while editing a header or footer.

## [0.1.0] - 2026-11-24

First public release.

### Packages

- `@quiredoc/sdk`: `createEditor` (one call to mount an editor), commands, immutable state snapshots, subscriptions, document load/save.
- `@quiredoc/react`: `useQuire`, `QuireEditor`, `useEditorState` (React 18+, StrictMode safe).
- `@quiredoc/editor`: the editor core (canvas rendering, input, accessibility mirror, plugins, themes, i18n).
- `@quiredoc/convert`: HWPX, DOCX, Markdown and HTML import/export (browser and Node).
- `@quiredoc/pdf`: PDF export with embedded subset fonts, from the editor or headless from a document.
- `@quiredoc/sync`: real-time collaboration (Loro CRDT), presence, version history, `.quire` files.
- `@quiredoc/model`, `@quiredoc/layout`, `@quiredoc/shaping`: document model, layout engine, HarfBuzz shaping.
- `@quiredoc/fonts`: Pretendard and Noto Sans KR font chunks (SIL OFL 1.1).

### Editing and layout

- Canvas rendering with an own layout engine: real pages, sections with their own paper and margins, columns, headers and footers with fields, footnotes, tables that split across pages, widow/orphan and keep-with-next control.
- Korean typesetting: line-breaking rules, justification, HarfBuzz shaping with font fallback; fonts load in chunks on demand.
- Korean IME through EditContext (hidden textarea fallback), verified with the Windows Microsoft Korean IME, including Hanja conversion.
- Formatting, paragraph styles, lists, images (inline and floating with wrapping), tables (merge, column widths, header rows), multiple cursors, paragraph drag.
- Comments, suggestion mode (track changes) with accept/reject, version history and comparison, permissions.
- Find and replace, spell-check interface, plugins API.

### Appearance and languages

- Themes (classic, minimal, modern) × light/dark, `--quire-*` CSS variables (fixed public names, `tokens.scss` for SCSS), collaborator palette `--quire-remote-1…8`, continuous view, formatting marks overlay, zoom (`setZoom`, fit to width, Ctrl+wheel).
- UI languages: Korean built in, English loaded on demand (`@quiredoc/editor/i18n/en`); import reports use stable kinds with translated names.

[Unreleased]: https://github.com/leessang10/quire/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/leessang10/quire/releases/tag/v0.1.0
