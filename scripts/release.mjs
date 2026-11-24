// 출시 (16 §10.8): 빌드한 @quiredoc/* 패키지(.build/packages)를 검사하고 npm에 의존 순서대로 올린다.
//   node scripts/build-packages.mjs && node scripts/release.mjs             → 검사 + npm publish --dry-run (기본)
//   node scripts/release.mjs --publish                                     → 실제로 올린다 (npm 로그인 또는 NODE_AUTH_TOKEN)
//   node scripts/release.mjs --publish --otp=123456                        → 2단계 인증 코드를 미리 준다
//   node scripts/release.mjs --publish --only=core,collab                  → 이것들만 올린다 (검사는 모두). 새 패키지를 처음 올릴 때 (16 §10.8)
//
// - 실제로 올릴 때는 npm을 이 터미널에 그대로 붙여 돌린다: 2단계 인증 코드나 브라우저 인증을 npm이 직접 묻는다.
//
// - 이미 올라간 판(이름@판)은 건너뛴다: 중간에 실패해도 다시 돌리면 남은 것만 올린다.
// - 판이 -alpha.1 같은 시험판이면 dist-tag를 next로 (latest를 건드리지 않는다).
// - npm은 NVM 셔림이 막는 기기가 있어 NPM_CLI(npm-cli.js 경로)가 있으면 노드로 직접 부른다.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(root, '.build', 'packages');
const publish = process.argv.includes('--publish');
const otp = process.argv.find((a) => a.startsWith('--otp='))?.slice('--otp='.length);
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
/** 올리는 순서: core 먼저 (모듈이 peer로 기댄다), 그다음 모듈과 글꼴 (19 §3) */
const ORDER = ['core', 'collab', 'convert', 'pdf', 'react', 'fonts'];
/** 폴더 안의 .js (재귀) */
const jsFiles = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? jsFiles(join(dir, f)) : f.endsWith('.js') ? [join(dir, f)] : [])) : []);
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
  if (j.name !== `@quiredoc/${p}`) bad(`이름이 @quiredoc/${p}가 아님 (${j.name})`);
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
  }
  // 19 §2: 모듈은 core를 peer로만 (`^판`), 다른 @quiredoc/*에는 기대지 않는다. core는 @quiredoc/*에 기대지 않는다
  for (const d of Object.keys(j.dependencies ?? {})) if (d.startsWith('@quiredoc/')) bad(`@quiredoc 의존은 peer여야 한다: ${d}`);
  for (const [d, v] of Object.entries(j.peerDependencies ?? {})) {
    if (!d.startsWith('@quiredoc/')) continue;
    if (p === 'core' || d !== '@quiredoc/core') bad(`peer ${d}는 안 된다 (모듈은 @quiredoc/core만)`);
    else if (v !== `^${VERSION}`) bad(`peer ${d}@${v} ≠ ^${VERSION}`);
  }
  // 묶음 안의 가져오기: core에는 @quiredoc/*·loro가 없다 (다섯 폴더는 묶었고 협업은 collab), 모듈은 @quiredoc/core만
  for (const f of jsFiles(join(dir, 'dist'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:from|import\()\s*["'](@quiredoc\/[^"']+|loro-crdt[^"']*)["']/g)) {
      const spec = m[1];
      if (p === 'core' ? true : spec.startsWith('@quiredoc/') && spec !== '@quiredoc/core') bad(`${f.slice(dir.length + 1)}가 ${spec}를 가져온다`);
    }
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
if (only) for (const n of only) if (!pkgs.some((x) => x.p === n)) throw new Error(`--only: 없는 패키지 ${n} (${pkgs.map((x) => x.p).join(', ')})`);
for (const { dir, name } of only ? pkgs.filter((x) => only.includes(x.p)) : pkgs) {
  let exists = false;
  try {
    // 캐시를 믿지 않는다: 방금 다른 곳(로컬·워크플로)에서 올린 판을 못 보고 다시 올리려 하면 실패한다
    exists = npm(['view', `${name}@${VERSION}`, 'version', '--prefer-online'], dir).trim() === VERSION;
  } catch {
    // 아직 없는 이름·판 (E404)
  }
  if (exists) {
    console.log(`  ${name}@${VERSION}: 이미 있음, 건너뜀`);
    continue;
  }
  const args = ['publish', '--access', 'public', '--tag', tag, ...(publish ? (otp ? [`--otp=${otp}`] : []) : ['--dry-run'])];
  if (publish) {
    // 터미널에 붙여 돌린다: npm이 OTP·브라우저 인증을 직접 묻는다 (출력을 가로채면 묻지 못하고 EOTP로 끝난다)
    console.log(`  ${name}@${VERSION}: 올리는 중…`);
    const cli = process.env.NPM_CLI;
    const res = cli
      ? spawnSync(process.execPath, [cli, ...args], { cwd: dir, stdio: 'inherit' })
      : spawnSync('npm', args, { cwd: dir, stdio: 'inherit', shell: true });
    if (res.status !== 0) {
      console.error(`${name}@${VERSION}를 올리지 못했다. 고친 뒤 다시 돌리면 이미 올라간 패키지는 건너뛴다.`);
      process.exit(res.status ?? 1);
    }
  } else npm(args, dir);
  console.log(`  ${name}@${VERSION}: ${publish ? '올림' : 'dry-run 통과'}`);
}
console.log(publish ? `완료: npm의 ${tag} 태그로 올렸다` : '완료 (dry-run): 실제로 올리려면 --publish');
