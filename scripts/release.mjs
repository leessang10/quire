// 출시 (16 §10.8): 빌드한 @quire/* 패키지(.build/packages)를 검사하고 npm에 의존 순서대로 올린다.
//   node scripts/build-packages.mjs && node scripts/release.mjs             → 검사 + npm publish --dry-run (기본)
//   node scripts/release.mjs --publish                                     → 실제로 올린다 (npm 로그인 또는 NODE_AUTH_TOKEN)
//
// - 이미 올라간 판(이름@판)은 건너뛴다: 중간에 실패해도 다시 돌리면 남은 것만 올린다.
// - 판이 -alpha.1 같은 시험판이면 dist-tag를 next로 (latest를 건드리지 않는다).
// - npm은 NVM 셔림이 막는 기기가 있어 NPM_CLI(npm-cli.js 경로)가 있으면 노드로 직접 부른다.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(root, '.build', 'packages');
const publish = process.argv.includes('--publish');
/** 의존 순서 (build-packages.mjs와 같다) + 글꼴 */
const ORDER = ['model', 'layout', 'shaping', 'editor', 'sync', 'convert', 'pdf', 'sdk', 'react', 'fonts'];
const VERSION = process.env.QUIRE_VERSION || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const npm = (args, cwd) => {
  const cli = process.env.NPM_CLI;
  const opts = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  return cli ? execFileSync(process.execPath, [cli, ...args], opts) : execFileSync('npm', args, { ...opts, shell: true });
};

// 1) 검사
const problems = [];
const pkgs = [];
for (const p of ORDER) {
  const dir = join(built, p);
  const file = join(dir, 'package.json');
  if (!existsSync(file)) {
    problems.push(`${p}: 빌드가 없음 (node scripts/build-packages.mjs 먼저)`);
    continue;
  }
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const bad = (m) => problems.push(`${j.name ?? p}: ${m}`);
  if (j.name !== `@quire/${p}`) bad(`이름이 @quire/${p}가 아님 (${j.name})`);
  if (j.version !== VERSION) bad(`판 ${j.version} ≠ ${VERSION}`);
  if (j.private) bad('private: true');
  if (j.license !== (p === 'fonts' ? 'OFL-1.1' : 'MIT')) bad(`license ${j.license}`);
  if (j.publishConfig?.access !== 'public') bad('publishConfig.access가 public이 아님');
  if (!j.repository?.url) bad('repository 없음');
  if (!j.description || /^Quire \w+$/.test(j.description)) bad('설명이 없음 (packages/<p>/package.json description)');
  if (!existsSync(join(dir, 'README.md'))) bad('README.md 없음');
  if (p !== 'fonts' && !existsSync(join(dir, 'LICENSE'))) bad('LICENSE 없음');
  for (const [d, v] of Object.entries({ ...j.dependencies, ...j.peerDependencies })) {
    if (/^(file|workspace|link):/.test(v) || v === '*') bad(`의존 ${d}@${v} (배포할 수 없는 판)`);
    if (d.startsWith('@quire/') && v !== VERSION) bad(`내부 의존 ${d}@${v} ≠ ${VERSION}`);
  }
  // exports가 가리키는 파일이 있다
  const targets = [];
  const walk = (v) => (typeof v === 'string' ? targets.push(v) : v && typeof v === 'object' && Object.values(v).forEach(walk));
  walk(j.exports ?? {});
  for (const t of [...targets, j.module, j.types].filter(Boolean)) if (!existsSync(join(dir, t))) bad(`exports 대상이 없음: ${t}`);
  pkgs.push({ p, dir, name: j.name });
}
if (problems.length) {
  console.error(`출시 검사 실패 (${problems.length}):\n${problems.map((m) => `  - ${m}`).join('\n')}`);
  process.exit(1);
}
console.log(`검사 통과: ${pkgs.length}개 패키지, 판 ${VERSION}`);

// 2) 올리기 (기본은 dry-run)
const tag = /-/.test(VERSION) ? 'next' : 'latest';
for (const { dir, name } of pkgs) {
  let exists = false;
  try {
    exists = npm(['view', `${name}@${VERSION}`, 'version'], dir).trim() === VERSION;
  } catch {
    // 아직 없는 이름·판 (E404)
  }
  if (exists) {
    console.log(`  ${name}@${VERSION}: 이미 있음, 건너뜀`);
    continue;
  }
  const args = ['publish', '--access', 'public', '--tag', tag, ...(publish ? [] : ['--dry-run'])];
  npm(args, dir);
  console.log(`  ${name}@${VERSION}: ${publish ? '올림' : 'dry-run 통과'}`);
}
console.log(publish ? `완료: npm의 ${tag} 태그로 올렸다` : '완료 (dry-run): 실제로 올리려면 --publish');
