'use client';
import { useState } from 'react';
import { Code2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buttonVariants } from '@/components/ui/button';
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
function ExamplePanel({ example, lang }: { example: Example; lang: Lang }) {
  const [shot, setShot] = useState(0);
  const t = T[lang];
  const label = example.label[lang];
  const current = example.shots[shot];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <p className="flex-1 basis-64 text-sm leading-relaxed text-muted-foreground">{example.desc[lang]}</p>
        <a href={tree(example.source)} className={buttonVariants({ variant: 'outline' })}>
          <Code2 aria-hidden="true" />
          {t.source(label)}
        </a>
      </div>
      <figure className="relative bg-muted/60">
        {/* Screenshots already ship as WebP and are shown without cropping. */}
        <img src={current.src} alt={t.alt(label, current.caption[lang])} width={1440} height={900} loading="lazy" className="aspect-[16/10] w-full object-contain" />
        <figcaption className="border-y bg-card px-4 py-2 text-sm text-muted-foreground sm:px-5">{current.caption[lang]}</figcaption>
      </figure>
      <ul aria-label={t.pick} className="flex flex-wrap gap-1.5 p-3">
        {example.shots.map((item, index) => (
          <li key={item.src}>
            <button type="button" aria-pressed={index === shot} onClick={() => setShot(index)}
              className={buttonVariants({ variant: index === shot ? 'secondary' : 'ghost', className: 'px-3' })}>
              {item.short[lang]}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Gallery({ lang }: { lang: Lang }) {
  const examples = [EXAMPLES[2], EXAMPLES[0], EXAMPLES[1], EXAMPLES[3]];
  return (
    <Tabs defaultValue="full" className="gap-3">
      <TabsList activateOnFocus aria-label={T[lang].tabs} className="h-auto! max-w-full flex-wrap justify-start! gap-0.5">
        {examples.map((example) => <TabsTrigger key={example.id} value={example.id} className="min-h-8 flex-none! px-2.5">{example.label[lang]}</TabsTrigger>)}
      </TabsList>
      {examples.map((example) => (
        <TabsContent key={example.id} value={example.id} className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <ExamplePanel example={example} lang={lang} />
        </TabsContent>
      ))}
      <a href={tree('examples')} className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{T[lang].all}</a>
    </Tabs>
  );
}
