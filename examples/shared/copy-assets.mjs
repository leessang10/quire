// 예제 앱의 공개 폴더에 Quire 자산을 복사한다: 글꼴 조각(@quiredoc/fonts), PDF용 hb-subset WASM
//   node ../shared/copy-assets.mjs <공개 폴더> [--samples]      (예: public, static)
// --samples: 저장소의 기준 문서 세트(fixtures/docs)를 <공개 폴더>/quire/samples에 (전체 기능 예제의 예제 문서)
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = resolve(process.argv[2] ?? 'public', 'quire');
const require = createRequire(join(process.cwd(), 'package.json'));
const fonts = join(require.resolve('@quiredoc/fonts/package.json'), '..', 'fonts');
const hb = require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
mkdirSync(dir, { recursive: true });
cpSync(fonts, join(dir, 'fonts'), { recursive: true });
if (existsSync(hb)) cpSync(hb, join(dir, 'harfbuzz-subset.wasm'));
if (process.argv.includes('--samples')) {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/docs');
  mkdirSync(join(dir, 'samples'), { recursive: true });
  for (const f of readdirSync(src)) if (f.endsWith('.json') && !f.endsWith('.expected.json')) cpSync(join(src, f), join(dir, 'samples', f));
}
console.log(`Quire 자산 → ${dir}`);
