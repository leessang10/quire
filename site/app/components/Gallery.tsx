'use client';
import { useRef, useState, type KeyboardEvent } from 'react';
import { tree } from '../../lib/links';

interface Shot {
  src: string;
  caption: string;
}
interface Example {
  id: string;
  label: string;
  desc: string;
  source: string;
  shots: Shot[];
}

const EXAMPLES: Example[] = [
  {
    id: 'word',
    label: 'Word식',
    desc: '리본 메뉴, 스타일 갤러리, 댓글·제안 패널을 갖춘 워드 프로세서. Next.js와 Tailwind로 만들었습니다.',
    source: 'examples/next-word',
    shots: [
      { src: '/examples/word-overview.webp', caption: '홈 리본과 댓글·제안 패널' },
      { src: '/examples/word-insert.webp', caption: '삽입 리본: 표, 그림, 각주, 머리말, 쪽·구역 나누기' },
      { src: '/examples/word-review.webp', caption: '검토 리본: 맞춤법, 메모, 변경 내용 추적' },
    ],
  },
  {
    id: 'notion',
    label: 'Notion식',
    desc: '사이드바 페이지 목록, 빗금(/) 명령, 어두운 테마를 갖춘 노트 앱입니다. Next.js와 Tailwind로 만들었습니다.',
    source: 'examples/next-notion',
    shots: [
      { src: '/examples/notion-overview.webp', caption: '페이지 목록과 넓은 본문' },
      { src: '/examples/notion-slash.webp', caption: '빗금(/)으로 여는 블록 메뉴' },
      { src: '/examples/notion-dark.webp', caption: '어두운 테마' },
    ],
  },
  {
    id: 'full',
    label: '전체 기능',
    desc: '메뉴 막대, 도구 막대, 개요, 댓글·제안 패널, 쪽 설정까지 Quire의 기능을 모두 담은 예제입니다. Next.js와 shadcn/ui로 만들었습니다.',
    source: 'examples/next-shadcn',
    shots: [
      { src: '/examples/shadcn-overview.webp', caption: '메뉴 막대, 도구 막대, 개요, 댓글 패널' },
      { src: '/examples/shadcn-table.webp', caption: '표 편집' },
      { src: '/examples/shadcn-page-setup.webp', caption: '쪽 설정: 용지, 여백, 다단, 쪽 번호' },
    ],
  },
  {
    id: 'basic',
    label: '기본',
    desc: '도구 막대 하나와 편집기만 있는 가장 작은 예제입니다. 단계별 가이드로 만드는 앱이 이 모습입니다.',
    source: 'examples',
    shots: [
      { src: '/examples/basic-next.webp', caption: 'Next.js + styled-components' },
      { src: '/examples/basic-svelte.webp', caption: 'SvelteKit' },
    ],
  },
];

export default function Gallery() {
  const [active, setActive] = useState(0);
  const [shot, setShot] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const ex = EXAMPLES[active];
  const current = ex.shots[shot] ?? ex.shots[0];

  const select = (i: number) => {
    setActive(i);
    setShot(0);
  };
  // 탭 목록: 화살표·Home·End로 이동 (APG tabs, 자동 선택)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = EXAMPLES.length;
    const next = { ArrowRight: active + 1, ArrowLeft: active - 1 + n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const i = next % n;
    select(i);
    tabs.current[i]?.focus();
  };

  return (
    <div className="gallery">
      <div className="gallery-tabs" role="tablist" aria-label="예제 앱" onKeyDown={onKeyDown}>
        {EXAMPLES.map((x, i) => (
          <button
            key={x.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`ex-tab-${x.id}`}
            aria-selected={i === active}
            aria-controls={`ex-panel-${x.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => select(i)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="gallery-panel" role="tabpanel" id={`ex-panel-${ex.id}`} aria-labelledby={`ex-tab-${ex.id}`}>
        <p className="desc">{ex.desc}</p>
        <figure className="shot">
          <img src={current.src} alt={`${ex.label} 예제: ${current.caption}`} width={1440} height={900} />
          <figcaption>{current.caption}</figcaption>
        </figure>
        <ul className="shots" aria-label="화면 고르기">
          {ex.shots.map((s, i) => (
            <li key={s.src}>
              <button type="button" aria-pressed={i === shot} onClick={() => setShot(i)}>
                <img src={s.src} alt="" width={1440} height={900} loading="lazy" />
                {s.caption.split(':')[0]}
              </button>
            </li>
          ))}
        </ul>
        <p className="gallery-links">
          <a href={tree(ex.source)}>{ex.label} 예제 소스 보기</a>
          <a href={tree('examples')}>예제 10개 전체와 실행 방법</a>
        </p>
      </div>
    </div>
  );
}
