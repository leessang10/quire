/// <reference types="node" />
/**
 * Node에서 워크스페이스 TypeScript 소스를 바로 돌리기 위한 해석 훅: 확장자 없는 상대 경로에 .ts(또는 /index.ts)를 붙인다.
 *   node --experimental-transform-types --import ./apps/sync-server/src/resolve.ts apps/sync-server/src/server.ts
 */
import { register } from 'node:module';

const hooks = `
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[cm]?[jt]s$/.test(specifier)) {
    for (const ext of ['.ts', '/index.ts']) {
      try {
        return await next(specifier + ext, context);
      } catch {}
    }
  }
  return next(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(hooks)}`, import.meta.url);
