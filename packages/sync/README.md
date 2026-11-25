# @quiredoc/collab

Real-time collaboration for the Quire editor: CRDT sync (Loro, runnable in a Worker), presence with theme-aware palette colors, per-user undo, version history and comparison, and the history section of `.quire` files.

Part of [Quire](https://github.com/leessang10/quire). Requires `@quiredoc/core` (peer dependency). Saving and loading documents without collaboration needs only `@quiredoc/core`; add this package when several people edit the same document.

Website, live demo and a step-by-step guide: https://quire-ten-omega.vercel.app

## Install

```sh
npm install @quiredoc/core @quiredoc/collab
```

## Usage

- `startSyncWorker` / `serveSyncWorker`: run sync in a Worker and connect the editor to it.
- `packQuireWithHistory({ loro })`: save a `.quire` file with its collaboration history; `restoreHistory(opened)`: reuse that history after `openQuire` (from core) when it matches the document.

## License

MIT

<!-- 저장소 안에서 이 패키지의 소스 폴더는 packages/sync이고 개발용 이름은 @quiredoc/sync다 (19 §3). -->
