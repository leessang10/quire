/**
 * core 하나의 이름공간 (19 §4.3, P-2): 0.2.0에서 model·layout·shaping·editor·sdk를 `@quiredoc/core` 하나로 묶으면
 * 공개 이름이 한 곳에 모인다. 각 패키지가 **스스로 내는** 이름(자기 모듈에서 내보내는 것)이 서로 겹치면 안 된다.
 * 다른 패키지 것을 다시 내보내는 것(`export … from '@quiredoc/editor'`)은 같은 것이라 겹침이 아니다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE = ['model', 'layout', 'shaping', 'editor', 'sdk'];

/** 패키지 진입점이 스스로 내는 이름 (다시 내보내기는 뺀다) */
function ownNames(pkg: string): string[] {
  const src = readFileSync(join('packages', pkg, 'src', 'index.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const names: string[] = [];
  for (const m of src.matchAll(/export (?:type )?\{([^}]*)\}(?: from '([^']+)')?/g)) {
    if (m[2]?.startsWith('@quiredoc/')) continue; // 다른 패키지 것을 다시 냄
    for (const item of m[1]!.split(',')) {
      const name = item.trim().replace(/^type /, '').split(/\s+as\s+/).pop()!.trim();
      if (name) names.push(name);
    }
  }
  for (const m of src.matchAll(/export (?:declare )?(?:async )?(?:function|class|const|let|interface|type|enum) (\w+)/g)) names.push(m[1]!);
  return names;
}

describe('core public names (19 §4.3)', () => {
  it('model, layout, shaping, editor and sdk export no name twice', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const p of CORE)
      for (const n of ownNames(p)) {
        const prev = owner.get(n);
        if (prev && prev !== p) clashes.push(`${n}: ${prev}, ${p}`);
        else owner.set(n, p);
      }
    expect(clashes).toEqual([]);
    expect(owner.size).toBeGreaterThan(300); // 이름을 제대로 읽었는가
  });
});
