import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 설치된 @quiredoc/core 판 (빌드 때 읽는다): 첫 화면 배지가 판을 올려도 맞게 */
export function coreVersion(): string {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'node_modules/@quiredoc/core/package.json'), 'utf8')).version;
  } catch {
    return '';
  }
}
