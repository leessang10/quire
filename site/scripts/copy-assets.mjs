// 공개 폴더에 Quire 자산을 복사한다: 글꼴 조각(@quiredoc/fonts), PDF 글꼴 부분화용 WASM(harfbuzzjs)
//   node scripts/copy-assets.mjs public
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = resolve(process.argv[2] ?? 'public', 'quire');
const require = createRequire(join(process.cwd(), 'package.json'));
const fonts = join(require.resolve('@quiredoc/fonts/package.json'), '..', 'fonts');
const hb = require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
mkdirSync(dir, { recursive: true });
cpSync(fonts, join(dir, 'fonts'), { recursive: true });
if (existsSync(hb)) cpSync(hb, join(dir, 'harfbuzz-subset.wasm'));
console.log(`Quire 자산 → ${dir}`);
