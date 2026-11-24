// 배포용 패키지 빌드 (16 §8, 6-6; 19 패키지 구성)
//   node scripts/build-packages.mjs            → .build/packages/<이름>/ (ESM + 타입 + package.json) 과 .build/packs/*.tgz
//
// 저장소의 패키지는 개발용으로 소스(src/index.ts)를 그대로 내보낸다. 이 스크립트는 저장소를 바꾸지 않고
// 1) tsc로 타입 선언(.d.ts)을, 2) Vite 라이브러리 모드로 배포 단위마다 ESM 묶음을 만들고,
// 3) 배포용 package.json을 써서 4) npm pack 한다.
//
// 배포 단위 (19 §3): 저장소 폴더와 배포 패키지가 1:1이 아니다.
// - @quiredoc/core = model·layout·shaping·editor·sdk 다섯 폴더를 packages/core/src/index.ts 하나로 묶는다 (서로의 가져오기가 묶음 안으로).
// - 모듈(react·collab·convert·pdf)은 core를 peerDependency로 두고, 다섯 폴더 이름(@quiredoc/model 등)으로 가져온 것을
//   결과 JS·타입에서 @quiredoc/core로 바꾼다. collab의 소스 폴더는 packages/sync (저장소 안 이름 @quiredoc/sync).
// 글꼴 조각(@quiredoc/fonts)은 scripts/build-fonts.mjs의 결과(조각 + manifest.json)를 담는다.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
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

/** core에 묶는 저장소 폴더 (의존 순서) */
const CORE_PARTS = ['model', 'layout', 'shaping', 'editor', 'sdk'];
const CORE_NAMES = new Set(CORE_PARTS.map((p) => `@quiredoc/${p}`));
/**
 * 배포 단위: name = npm 이름(@quiredoc/<name>), dir = 저장소 폴더(packages/<dir>).
 * entries = index 밖의 진입점(하위 경로 → 소스), extra = 함께 싣는 파일(배포 경로 → 소스), 둘 다 exports에도 연다
 */
const UNITS = [
  {
    name: 'core',
    dir: 'core',
    entries: { 'i18n/en': 'packages/editor/src/i18n/en.ts' }, // 편집기가 필요할 때 import()로 받는 번역도 같은 파일 (18 §5)
    entryTypes: { 'i18n/en': 'editor/i18n/en.d.ts' },
    extra: { 'tokens.scss': 'packages/editor/tokens.scss' },
  },
  { name: 'collab', dir: 'sync' },
  { name: 'convert', dir: 'convert' },
  { name: 'pdf', dir: 'pdf' },
  { name: 'react', dir: 'react' },
];
/** 타입 선언을 낼 저장소 폴더 */
const TYPE_DIRS = [...new Set([...CORE_PARTS, ...UNITS.map((u) => u.dir)])];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const npm = (args, cwd) => {
  // npm은 NVM 셔림이 막는 기기가 있어 노드로 npm-cli를 직접 부른다 (그 밖에는 npm)
  const cli = process.env.NPM_CLI;
  return cli ? execFileSync(process.execPath, [cli, ...args], { cwd, stdio: 'pipe' }).toString() : execFileSync('npm', args, { cwd, stdio: 'pipe', shell: true }).toString();
};
/** 폴더 안의 파일 (재귀) */
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const posix = (p) => p.split(sep).join('/');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'packs'), { recursive: true });

// 1) 타입 선언: 패키지 소스 전체를 한 번에 (서로의 타입을 '@quiredoc/…'로 가리킨다)
const tsconfig = {
  extends: '../tsconfig.json',
  compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: './types', rootDir: '../packages', noUnusedLocals: false, skipLibCheck: true },
  include: TYPE_DIRS.map((p) => `../packages/${p}/src`),
  exclude: ['../packages/**/*.test.ts', '../packages/**/*.test-util.ts'],
};
writeFileSync(join(out, 'tsconfig.types.json'), JSON.stringify(tsconfig, null, 2));
console.log('타입 선언…');
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(out, 'tsconfig.types.json')], { stdio: 'inherit' });

for (const unit of UNITS) {
  const { name, dir } = unit;
  const isCore = name === 'core';
  const src = readJson(join(root, 'packages', dir, 'package.json'));
  const dest = join(out, 'packages', name);
  mkdirSync(join(dest, 'dist'), { recursive: true });

  // 의존: core는 다섯 폴더의 바깥 의존을 모은다 (다섯 폴더끼리는 묶음 안). 모듈은 다섯 폴더 → core(peer)
  const deps = {};
  const peers = { ...(src.peerDependencies ?? {}) };
  for (const [k, v] of Object.entries(isCore ? Object.assign({}, ...CORE_PARTS.map((p) => readJson(join(root, 'packages', p, 'package.json')).dependencies ?? {})) : (src.dependencies ?? {}))) {
    if (CORE_NAMES.has(k) || k === '@quiredoc/core') {
      if (!isCore) peers['@quiredoc/core'] = `^${VERSION}`;
    } else if (k.startsWith('@quiredoc/')) throw new Error(`${name}: 다른 모듈(${k})에 의존하면 안 된다 (19 §2)`);
    else deps[k] = v;
  }
  const externalNames = [...Object.keys(deps), ...Object.keys(peers)];
  const external = (id) =>
    (!isCore && id.startsWith('@quiredoc/')) || externalNames.some((e) => id === e || id.startsWith(`${e}/`)) || id.startsWith('node:');

  // 2) ESM 묶음: 의존 패키지는 밖에 둔다 (harfbuzzjs/dist/*.wasm 같은 하위 경로도)
  console.log(`@quiredoc/${name}${dir !== name ? ` (packages/${dir})` : ''}…`);
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
        entry: { index: join(root, 'packages', dir, 'src/index.ts'), ...Object.fromEntries(Object.entries(unit.entries ?? {}).map(([k, f]) => [k, join(root, f)])) },
        formats: ['es'],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      rollupOptions: { external },
    },
  });
  for (const f of walk(join(dest, 'dist')).filter((f) => f.endsWith('.js'))) {
    let s = readFileSync(f, 'utf8');
    // loro-crdt → loro-crdt/base64: 기본 브라우저 빌드는 .wasm을 ES 모듈로 가져와 앱마다 번들러 설정이 필요하다 (WASM을 담은 base64 빌드). 외부 의존은 별칭보다 먼저 정해지므로 결과에서 바꾼다
    s = s.replace(/from "loro-crdt"/g, 'from "loro-crdt/base64"');
    // 모듈: 저장소 안 이름(@quiredoc/model 등) → @quiredoc/core
    if (!isCore) s = s.replace(/(["'])@quiredoc\/(model|layout|shaping|editor|sdk)\1/g, '$1@quiredoc/core$1');
    writeFileSync(f, s);
  }

  // 타입: types/<dir>/src → dist/types. core는 다섯 폴더를 dist/types/<폴더>/에 두고 서로의 '@quiredoc/<폴더>'를 상대 경로로 바꾼다
  const typesDir = join(dest, 'dist', 'types');
  cpSync(join(out, 'types', dir, 'src'), typesDir, { recursive: true });
  if (isCore) for (const p of CORE_PARTS) cpSync(join(out, 'types', p, 'src'), join(typesDir, p), { recursive: true });
  for (const f of walk(typesDir).filter((f) => f.endsWith('.d.ts'))) {
    const s = readFileSync(f, 'utf8').replace(/(["'])@quiredoc\/(model|layout|shaping|editor|sdk)\1/g, (_m, q, p) => {
      if (!isCore) return `${q}@quiredoc/core${q}`;
      let rel = posix(relative(dirname(f), join(typesDir, p, 'index')));
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${q}${rel}${q}`;
    });
    writeFileSync(f, s);
  }

  // 3) 배포용 package.json
  const pkg = {
    name: `@quiredoc/${name}`,
    version: VERSION,
    description: src.description ?? `Quire ${name}`,
    ...(src.keywords ? { keywords: src.keywords } : {}),
    license: 'MIT',
    ...meta(`packages/${dir}`),
    type: 'module',
    sideEffects: false,
    exports: {
      '.': { types: './dist/types/index.d.ts', import: './dist/index.js' },
      ...Object.fromEntries(Object.keys(unit.entries ?? {}).map((k) => [`./${k}`, { types: `./dist/types/${unit.entryTypes?.[k] ?? `${k}.d.ts`}`, import: `./dist/${k}.js` }])),
      ...Object.fromEntries(Object.keys(unit.extra ?? {}).map((f) => [`./${f}`, `./${f}`])),
    },
    module: './dist/index.js',
    types: './dist/types/index.d.ts',
    files: ['dist', 'LICENSE', ...Object.keys(unit.extra ?? {})],
    dependencies: deps,
    ...(Object.keys(peers).length ? { peerDependencies: peers } : {}),
  };
  writeFileSync(join(dest, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const [to, from] of Object.entries(unit.extra ?? {})) cpSync(join(root, from), join(dest, to));
  cpSync(join(root, 'LICENSE'), join(dest, 'LICENSE'));
  const readme = join(root, 'packages', dir, 'README.md');
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

// 4) npm pack. 판이 붙은 이름(출시·GitHub Release용)과 함께 판 없는 사본 packs/latest/quiredoc-<이름>.tgz를 둔다:
// 예제들이 이것을 가리켜 판을 올려도 예제 package.json을 고치지 않는다
mkdirSync(join(out, 'packs', 'latest'), { recursive: true });
for (const name of [...UNITS.map((u) => u.name), 'fonts']) {
  const dir = join(out, 'packages', name);
  const file = npm(['pack', '--pack-destination', join(out, 'packs')], dir).trim().split('\n').pop();
  cpSync(join(out, 'packs', file), join(out, 'packs', 'latest', `quiredoc-${name}.tgz`));
  console.log(`  ${relative(root, join(out, 'packs', file))}`);
}
console.log(`완료: ${readdirSync(join(out, 'packs')).filter((f) => f.endsWith('.tgz')).length}개 tarball (판 없는 사본: .build/packs/latest)`);
