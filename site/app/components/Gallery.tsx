'use client';
import { useRef, useState, type KeyboardEvent } from 'react';
import { tree } from '../../lib/links';
import type { Lang } from '../../lib/i18n';

type L = Record<Lang, string>;
interface Shot {
  src: string;
  caption: L;
  /** 작은 그림 아래 짧은 이름 */
  short: L;
}
interface Example {
  id: string;
  label: L;
  desc: L;
  source: string;
  shots: Shot[];
}

const EXAMPLES: Example[] = [
  {
    id: 'word',
    label: { ko: 'Word식', en: 'Word-style' },
    desc: {
      ko: '리본 메뉴, 스타일 갤러리, 댓글·제안 패널을 갖춘 워드 프로세서입니다. Next.js와 Tailwind로 지었습니다.',
      en: 'A word processor with a ribbon, a style gallery and a comments and suggestions panel. Built with Next.js and Tailwind.',
    },
    source: 'examples/next-word',
    shots: [
      { src: '/examples/word-overview.webp', short: { ko: '홈', en: 'Home' }, caption: { ko: '홈 리본과 댓글·제안 패널', en: 'Home ribbon with the comments and suggestions panel' } },
      { src: '/examples/word-insert.webp', short: { ko: '삽입', en: 'Insert' }, caption: { ko: '삽입 리본: 표, 그림, 각주, 머리말, 쪽·구역 나누기', en: 'Insert ribbon: tables, pictures, footnotes, headers, page and section breaks' } },
      { src: '/examples/word-review.webp', short: { ko: '검토', en: 'Review' }, caption: { ko: '검토 리본: 맞춤법, 메모, 변경 내용 추적', en: 'Review ribbon: spelling, notes, track changes' } },
    ],
  },
  {
    id: 'notion',
    label: { ko: 'Notion식', en: 'Notion-style' },
    desc: {
      ko: '사이드바 페이지 목록, 빗금(/) 명령, 어두운 테마를 갖춘 노트입니다. Next.js와 Tailwind로 지었습니다.',
      en: 'A notebook with a page sidebar, slash commands and a dark theme. Built with Next.js and Tailwind.',
    },
    source: 'examples/next-notion',
    shots: [
      { src: '/examples/notion-overview.webp', short: { ko: '본문', en: 'Page' }, caption: { ko: '페이지 목록과 넓은 본문', en: 'Page list and a wide body' } },
      { src: '/examples/notion-slash.webp', short: { ko: '빗금 메뉴', en: 'Slash menu' }, caption: { ko: '빗금(/)으로 여는 블록 메뉴', en: 'Block menu opened with a slash (/)' } },
      { src: '/examples/notion-dark.webp', short: { ko: '어두운 테마', en: 'Dark' }, caption: { ko: '어두운 테마', en: 'Dark theme' } },
    ],
  },
  {
    id: 'full',
    label: { ko: '전체 기능', en: 'Full featured' },
    desc: {
      ko: '메뉴 막대, 도구 막대, 개요, 댓글·제안 패널, 쪽 설정까지 Quire의 기능을 모두 담았습니다. Next.js와 shadcn/ui로 지었습니다.',
      en: 'Every Quire feature in one app: menu bar, toolbar, outline, comments and suggestions, page setup. Built with Next.js and shadcn/ui.',
    },
    source: 'examples/next-shadcn',
    shots: [
      { src: '/examples/shadcn-overview.webp', short: { ko: '전체', en: 'Overview' }, caption: { ko: '메뉴 막대, 도구 막대, 개요, 댓글 패널', en: 'Menu bar, toolbar, outline and comments panel' } },
      { src: '/examples/shadcn-table.webp', short: { ko: '표', en: 'Tables' }, caption: { ko: '표 편집', en: 'Editing a table' } },
      { src: '/examples/shadcn-page-setup.webp', short: { ko: '쪽 설정', en: 'Page setup' }, caption: { ko: '쪽 설정: 용지, 여백, 다단, 쪽 번호', en: 'Page setup: paper, margins, columns, page numbers' } },
    ],
  },
  {
    id: 'basic',
    label: { ko: '기본', en: 'Basic' },
    desc: {
      ko: '도구 막대 하나와 편집기만 있는 가장 작은 예제입니다. 단계별 가이드로 만드는 앱이 이 모습입니다.',
      en: 'The smallest example: one toolbar and the editor. This is what the step-by-step guide builds.',
    },
    source: 'examples',
    shots: [
      { src: '/examples/basic-next.webp', short: { ko: 'Next.js', en: 'Next.js' }, caption: { ko: 'Next.js + styled-components', en: 'Next.js + styled-components' } },
      { src: '/examples/basic-svelte.webp', short: { ko: 'SvelteKit', en: 'SvelteKit' }, caption: { ko: 'SvelteKit', en: 'SvelteKit' } },
    ],
  },
];

const T = {
  ko: {
    tabs: '예제 앱',
    pick: '화면 고르기',
    alt: (label: string, caption: string) => `${label} 예제: ${caption}`,
    source: (label: string) => `${label} 예제 소스 보기`,
    all: '예제 10개 전체와 실행 방법',
  },
  en: {
    tabs: 'Example apps',
    pick: 'Choose a screen',
    alt: (label: string, caption: string) => `${label} example: ${caption}`,
    source: (label: string) => `View the ${label} source`,
    all: 'All 10 examples and how to run them',
  },
};

export default function Gallery({ lang }: { lang: Lang }) {
  const t = T[lang];
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
      <div className="gallery-tabs" role="tablist" aria-label={t.tabs} onKeyDown={onKeyDown}>
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
            {x.label[lang]}
          </button>
        ))}
      </div>
      <div className="gallery-panel" role="tabpanel" id={`ex-panel-${ex.id}`} aria-labelledby={`ex-tab-${ex.id}`}>
        <p className="desc">{ex.desc[lang]}</p>
        <figure className="shot">
          <img src={current.src} alt={t.alt(ex.label[lang], current.caption[lang])} width={1440} height={900} />
          <figcaption>{current.caption[lang]}</figcaption>
        </figure>
        <ul className="shots" aria-label={t.pick}>
          {ex.shots.map((s, i) => (
            <li key={s.src}>
              <button type="button" aria-pressed={i === shot} onClick={() => setShot(i)}>
                <img src={s.src} alt="" width={1440} height={900} loading="lazy" />
                {s.short[lang]}
              </button>
            </li>
          ))}
        </ul>
        <p className="gallery-links">
          <a href={tree(ex.source)}>{t.source(ex.label[lang])}</a>
          <a href={tree('examples')}>{t.all}</a>
        </p>
      </div>
    </div>
  );
}
