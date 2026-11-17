/**
 * 조각난 글꼴의 목록 (scripts/build-fonts.mjs가 만듦, 02 §4 부분 로드). 조각마다 글꼴 자리(FontSlot) 하나가 된다.
 */
import type { FontSlot } from './shaper';

export interface FontManifest {
  id: string;
  name: string;
  chunks: Array<{ name: string; file: string; bytes: number; count: number; cover: string }>;
}

/** 조각 하나 = 불러오기 전 자리 (url: 조각 파일 주소) */
export interface ChunkSlot extends FontSlot {
  url: string;
  bytes: number;
}

/** cover 문자열 → 범위 [첫, 끝] (양끝 포함, 정렬됨). 형식은 build-fonts.mjs의 encodeCover */
export function decodeCover(cover: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!cover) return out;
  let prev = -1;
  for (const part of cover.split(',')) {
    const dot = part.indexOf('.');
    const gap = parseInt(dot < 0 ? part : part.slice(0, dot), 36);
    const extra = dot < 0 ? 0 : parseInt(part.slice(dot + 1), 36);
    const a = prev + 1 + gap;
    out.push([a, a + extra]);
    prev = a + extra;
  }
  return out;
}

export function slotsFromManifest(m: FontManifest, baseUrl: string | URL): ChunkSlot[] {
  return m.chunks.map((c) => {
    const rs = decodeCover(c.cover);
    const starts = Int32Array.from(rs, (r) => r[0]);
    const ends = Int32Array.from(rs, (r) => r[1]);
    return {
      name: `${m.name} ${c.name}`,
      url: new URL(c.file, baseUrl).href,
      bytes: c.bytes,
      font: null,
      covers(cp: number) {
        // 범위는 정렬되어 있다: 이분 탐색
        let lo = 0;
        let hi = starts.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (cp < starts[mid]!) hi = mid - 1;
          else if (cp > ends[mid]!) lo = mid + 1;
          else return true;
        }
        return false;
      },
    };
  });
}
