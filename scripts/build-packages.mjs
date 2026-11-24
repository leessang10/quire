// 배포용 패키지 빌드 (16 §8, 6-6)
//   node scripts/build-packages.mjs            → .build/packages/<이름>/ (ESM + 타입 + package.json) 과 .build/packs/*.tgz
//
// 저장소의 패키지는 개발용으로 소스(src/index.ts)를 그대로 내보낸다. 이 스크립트는 저장소를 바꾸지 않고
// 1) tsc로 타입 선언(.d.ts)을, 2) Vite 라이브러리 모드로 패키지마다 ESM 묶음(dist/index.js)을 만들고,
// 3) 배포용 package.json(exports → dist, 내부 의존 버전 고정)을 써서 4) npm pack 한다.
// 글꼴 조각(@quiredoc/fonts)은 scripts/build-fonts.mjs의 결과(조각 + manifest.json)를 담는다.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.build');
/** 판: 저장소 루트 package.json의 version 하나 (모든 @quiredoc/* 패키지가 같은 판, 16 §10.8). QUIRE_VERSION으로 덮어쓸 수 있다 (출시 워크플로가 태그와 맞춘다) */
const VERSION = process.env.QUIRE_VERSION || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(VERSION ?? '')) throw new Error(`판이 semver가 아님: ${VERSION}`);
/** 배포용 package.json에 같이 쓰는 것 */
const REPO = 'https://github.com/leessang10/quire';
const meta = (dir) => ({
  repository: { type: 'git', url: `git+${REPO}.git`, directory: dir },
  homepage: `${REPO}#readme`,
  bugs: { url: `${REPO}/issues` },
  publishConfig: { access: 'public' },
});
/** dist 밖에 함께 싣는 파일 (패키지 → 파일, exports에도 연다) */
const EXTRA = { editor: ['tokens.scss'] };
/** index 밖의 진입점 (패키지 → 하위 경로 → 소스). 편집기가 필요할 때 import()로 받는 번역도 같은 파일을 쓴다 (18 §5 나눠 싣기) */
const ENTRIES = { editor: { 'i18n/en': 'src/i18n/en.ts' } };
/** 의존 순서 (앞이 먼저) */
const PACKAGES = ['model', 'layout', 'shaping', 'editor', 'sync', 'convert', 'pdf', 'sdk', 'react'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const npm = (args, cwd) => {
  // npm은 NVM 셔림이 막는 기기가 있어 노드로 npm-cli를 직접 부른다 (그 밖에는 npm)
  const cli = process.env.NPM_CLI;
  return cli ? execFileSync(process.execPath, [cli, ...args], { cwd, stdio: 'pipe' }).toString() : execFileSync('npm', args, { cwd, stdio: 'pipe', shell: true }).toString();
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'packs'), { recursive: true });

// 1) 타입 선언: 패키지 소스 전체를 한 번에 (서로의 타입을 '@quiredoc/…'로 가리킨다)
const tsconfig = {
  extends: '../tsconfig.json',
  compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: './types', rootDir: '../packages', noUnusedLocals: false, skipLibCheck: true },
  include: PACKAGES.map((p) => `../packages/${p}/src`),
  exclude: ['../packages/**/*.test.ts', '../packages/**/*.test-util.ts'],
};
writeFileSync(join(out, 'tsconfig.types.json'), JSON.stringify(tsconfig, null, 2));
console.log('타입 선언…');
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(out, 'tsconfig.types.json')], { stdio: 'inherit' });

const manifests = Object.fromEntries(PACKAGES.map((p) => [p, readJson(join(root, 'packages', p, 'package.json'))]));

for (const p of PACKAGES) {
  const src = manifests[p];
  const dest = join(out, 'packages', p);
  mkdirSync(join(dest, 'dist'), { recursive: true });
  const deps = { ...(src.dependencies ?? {}) };
  for (const k of Object.keys(deps)) if (k.startsWith('@quiredoc/')) deps[k] = VERSION;
  const peers = { ...(src.peerDependencies ?? {}) };
  const external = [...Object.keys(deps), ...Object.keys(peers)];
  // 2) ESM 묶음: 의존 패키지는 밖에 둔다 (harfbuzzjs/dist/*.wasm 같은 하위 경로도)
  console.log(`${src.name}…`);
  await build({
    configFile: false,
    logLevel: 'warn',
    root,
    build: {
      outDir: join(dest, 'dist'),
      emptyOutDir: false,
      minify: false,
      sourcemap: true,
      target: 'es2022',
      lib: {
        entry: { index: join(root, 'packages', p, 'src/index.ts'), ...Object.fromEntries(Object.entries(ENTRIES[p] ?? {}).map(([k, f]) => [k, join(root, 'packages', p, f)])) },
        formats: ['es'],
        fileName: (_format, name) => `${name}.js`,
      },
      rollupOptions: { external: (id) => external.some((e) => id === e || id.startsWith(`${e}/`)) || id.startsWith('node:') },
    },
  });
  // loro-crdt → loro-crdt/base64: 기본 브라우저 빌드는 .wasm을 ES 모듈로 가져와 앱마다 번들러 설정이 필요하다 (WASM을 담은 base64 빌드). 외부 의존은 별칭보다 먼저 정해지므로 결과에서 바꾼다)
  const js = join(dest, 'dist', 'index.js');
  writeFileSync(js, readFileSync(js, 'utf8').replace(/from "loro-crdt"/g, 'from "loro-crdt/base64"'));
  // 타입: types/<p>/src → dist/types
  cpSync(join(out, 'types', p, 'src'), join(dest, 'dist', 'types'), { recursive: true });
  // 3) 배포용 package.json
  const pkg = {
    name: src.name,
    version: VERSION,
    description: src.description ?? `Quire ${p}`,
    ...(src.keywords ? { keywords: src.keywords } : {}),
    license: 'MIT',
    ...meta(`packages/${p}`),
    type: 'module',
    sideEffects: false,
    exports: {
      '.': { types: './dist/types/index.d.ts', import: './dist/index.js' },
      ...Object.fromEntries(Object.keys(ENTRIES[p] ?? {}).map((k) => [`./${k}`, { types: `./dist/types/${k}.d.ts`, import: `./dist/${k}.js` }])),
      ...(EXTRA[p] ? Object.fromEntries(EXTRA[p].map((f) => [`./${f}`, `./${f}`])) : {}) },
    module: './dist/index.js',
    types: './dist/types/index.d.ts',
    files: ['dist', 'LICENSE', ...(EXTRA[p] ?? [])],
    dependencies: deps,
    ...(Object.keys(peers).length ? { peerDependencies: peers } : {}),
  };
  writeFileSync(join(dest, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const f of EXTRA[p] ?? []) cpSync(join(root, 'packages', p, f), join(dest, f));
  cpSync(join(root, 'LICENSE'), join(dest, 'LICENSE'));
  const readme = join(root, 'packages', p, 'README.md');
  if (existsSync(readme)) cpSync(readme, join(dest, 'README.md'));
}

// @quiredoc/fonts: 글꼴 조각 (없으면 만든다)
const fontsSrc = join(root, 'apps/playground/public/fonts');
if (!existsSync(join(fontsSrc, 'pretendard/manifest.json'))) {
  console.log('글꼴 조각 만들기…');
  execFileSync(process.execPath, [join(root, 'scripts/build-fonts.mjs')], { stdio: 'inherit' });
}
{
  const dest = join(out, 'packages', 'fonts');
  cpSync(fontsSrc, join(dest, 'fonts'), { recursive: true });
  writeFileSync(
    join(dest, 'README.md'),
    [
      '# @quiredoc/fonts',
      '',
      `Font chunks and manifests used by the [Quire](${REPO}) editor: Pretendard and Noto Sans KR, split so the editor loads only the chunks a document needs.`,
      '',
      "Copy `node_modules/@quiredoc/fonts/fonts` to `<public>/quire/fonts/` and point the editor's `fonts` option at the manifests.",
      '',
      '## License',
      '',
      'The fonts are licensed under the SIL Open Font License 1.1 (see `LICENSE-pretendard.txt` and `LICENSE-noto-sans-kr.txt`).',
      '',
    ].join('\n'),
  );
  for (const lic of ['pretendard', 'noto-sans-kr']) {
    const l = join(root, 'fonts', lic, 'LICENSE.txt');
    if (existsSync(l)) cpSync(l, join(dest, `LICENSE-${lic}.txt`));
  }
  writeFileSync(
    join(dest, 'package.json'),
    `${JSON.stringify(
      {
        name: '@quiredoc/fonts',
        version: VERSION,
        description: 'Font chunks for the Quire engine (Pretendard, Noto Sans KR; SIL OFL 1.1): copy into the public folder of your app',
        keywords: ['fonts', 'korean', 'pretendard', 'noto-sans-kr'],
        license: 'OFL-1.1',
        ...meta('fonts'),
        files: ['fonts', 'LICENSE-*.txt', 'README.md'],
      },
      null,
      2,
    )}\n`,
  );
}

// 4) npm pack
for (const p of [...PACKAGES, 'fonts']) {
  const dir = join(out, 'packages', p);
  const name = npm(['pack', '--pack-destination', join(out, 'packs')], dir).trim().split('\n').pop();
  console.log(`  ${relative(root, join(out, 'packs', name))}`);
}
console.log(`완료: ${readdirSync(join(out, 'packs')).length}개 tarball`);
