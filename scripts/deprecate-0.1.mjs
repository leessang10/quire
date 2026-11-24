// 0.2.0에서 내지 않는 0.1.0 패키지에 사용 중단 안내를 건다 (19 §6). 패키지와 0.1.0은 지우지 않는다: 설치한 사람이 깨지지 않게.
//   node scripts/deprecate-0.1.mjs          → 걸 안내를 보여 준다 (아무것도 바꾸지 않음)
//   node scripts/deprecate-0.1.mjs --run    → npm deprecate를 실제로 (npm 로그인 필요, 2단계 인증 코드를 npm이 묻는다)
// npm은 NVM 셔림이 막는 기기가 있어 NPM_CLI(npm-cli.js 경로)가 있으면 노드로 직접 부른다.
import { spawnSync } from 'node:child_process';

const CORE = 'Merged into @quiredoc/core in 0.2.0. Install @quiredoc/core instead (same APIs, one package).';
const NOTICES = {
  '@quiredoc/model': CORE,
  '@quiredoc/layout': CORE,
  '@quiredoc/shaping': CORE,
  '@quiredoc/editor': `${CORE} Subpaths: @quiredoc/core/i18n/en, @quiredoc/core/tokens.scss.`,
  '@quiredoc/sdk': CORE,
  '@quiredoc/sync':
    'Split in 0.2.0: document JSON and .quire files (QuireDoc, packQuire, openQuire …) are in @quiredoc/core; collaboration is @quiredoc/collab.',
};

const run = process.argv.includes('--run');
for (const [name, message] of Object.entries(NOTICES)) {
  console.log(`${name}: ${message}`);
  if (!run) continue;
  const args = ['deprecate', name, message];
  const cli = process.env.NPM_CLI;
  const res = cli ? spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' }) : spawnSync('npm', args, { stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    console.error(`${name}: 실패. 고친 뒤 다시 돌리면 된다 (이미 건 안내는 덮어쓴다)`);
    process.exit(res.status ?? 1);
  }
}
if (!run) console.log('\n(보기만) 실제로 걸려면 --run');
