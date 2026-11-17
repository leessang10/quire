// 브라우저 실험용 글꼴을 플레이그라운드 public으로 복사한다 (Windows 시스템 글꼴, 저장소에 넣지 않음: .gitignore)
//   node spikes/shaping/prepare-fonts.mjs
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
const out = new URL('../../apps/playground/public/spike-fonts/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const f of ['malgun.ttf', 'calibri.ttf']) {
  const src = `C:/Windows/Fonts/${f}`;
  if (!existsSync(src)) {
    console.log(`없음: ${src}`);
    continue;
  }
  copyFileSync(src, new URL(f, out));
  console.log(`복사: ${f}`);
}
