import Link from 'next/link';
import { BookOpen, Boxes, FileText, Languages, Layers3, Play, Table2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { href, type Lang } from '@/lib/i18n';
import { doc, tree } from '@/lib/links';
import { coreVersion } from '@/lib/version';
import Demo from './Demo';
import Gallery from './Gallery';
import InstallCommand from './InstallCommand';

const features = [
  {
    icon: Layers3,
    ko: ['실제 페이지', '머리말, 꼬리말, 각주와 다단을 포함해 문서를 조판합니다. 편집 화면과 PDF가 같은 페이지 구성을 사용합니다.'],
    en: ['Real page layout', 'Typeset headers, footers, footnotes and columns. The editor and PDF use the same page layout.'],
  },
  {
    icon: Languages,
    ko: ['한글 조판과 입력', '어절 단위 줄바꿈, 금칙 처리, 양쪽 맞춤을 지원합니다. 한글 입력기로 글자를 조합하고 한자를 변환할 수 있습니다.'],
    en: ['Korean typesetting and input', 'Break lines at word boundaries, keep punctuation in place, justify text, and compose Korean with your native IME.'],
  },
  {
    icon: FileText,
    ko: ['HWPX, DOCX, PDF', '브라우저에서 한글·워드 문서를 열고 저장합니다. PDF는 문서에 사용한 글꼴을 포함합니다.'],
    en: ['HWPX, DOCX and PDF', 'Open and save Hancom Office and Word files in the browser. PDF export embeds the fonts used in the document.'],
  },
  {
    icon: Table2,
    ko: ['여러 쪽에 걸친 표', '페이지 경계를 넘어 이어지는 표를 편집하고 여러 쪽으로 출력할 수 있습니다.'],
    en: ['Tables across pages', 'Edit tables that flow across page boundaries and print them over multiple pages.'],
  },
  {
    icon: Boxes,
    ko: ['모듈형 패키지', '코어에 React 바인딩, 문서 변환, PDF 내보내기, 실시간 협업을 필요한 만큼 추가합니다.'],
    en: ['Modular packages', 'Start with the core and add React bindings, document conversion, PDF export or real-time collaboration as needed.'],
  },
  {
    icon: BookOpen,
    ko: ['긴 문서 편집', '화면에 보이는 쪽을 그리고 편집한 문단을 다시 조판합니다.'],
    en: ['Long documents', 'Draw the visible pages and reflow paragraphs as they are edited.'],
  },
] as const;

const copy = {
  ko: {
    title: <>페이지가 있는<br />웹 문서 편집기</>,
    lead: 'Quire는 자체 조판 엔진을 갖춘 오픈소스 편집기입니다. 웹에서 한글·워드 문서를 편집하고 같은 레이아웃으로 PDF를 내보내세요.',
    try: '데모 써 보기',
    docs: 'API 문서',
    install: '설치',
    guide: 'Next.js 시작 가이드',
    demo: '편집기 데모',
    skipDemo: '편집기 건너뛰기',
    features: '문서 편집에 필요한 기능',
    examples: '예제 앱',
    exampleLead: '같은 Quire 엔진을 서로 다른 편집 화면에 적용한 예제입니다.',
    resources: '개발 자료',
    links: [
      ['가이드', 'Next.js 앱에 편집기와 파일 기능을 붙이는 방법', '/guide'],
      ['API 문서', '옵션, 명령, React 바인딩, 플러그인', '/docs'],
      ['전체 예제', 'React, Next.js, Vue, Svelte, Node.js 등', tree('examples')],
    ],
  },
  en: {
    title: <>A web document editor<br />with real pages</>,
    lead: 'Quire is an open-source editor with its own typesetting engine. Edit Hancom Office and Word documents in your web app and export PDFs with the same layout.',
    try: 'Try the demo',
    docs: 'API reference',
    install: 'Installation',
    guide: 'Next.js getting started guide',
    demo: 'Editor demo',
    skipDemo: 'Skip the editor',
    features: 'Built for paginated documents',
    examples: 'Example apps',
    exampleLead: 'Explore different editing interfaces built on the same Quire engine.',
    resources: 'Developer resources',
    links: [
      ['Guide', 'Add an editor and file handling to a Next.js app', '/guide'],
      ['API reference', 'Options, commands, React bindings and plugins', '/docs'],
      ['All examples', 'React, Next.js, Vue, Svelte, Node.js and more', tree('examples')],
    ],
  },
};

export default function Home({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const version = coreVersion();
  const guide = href(lang, '/guide');

  return (
    <div className="site-width">
      <section aria-labelledby="home-title" className="grid items-end gap-8 pt-12 pb-9 sm:pt-19 sm:pb-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <div>
          <a href={doc('CHANGELOG.md')} className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            Quire{version && ` v${version}`} <span aria-hidden="true">·</span> MIT
          </a>
          <h1 id="home-title" className="mt-5 text-[clamp(2.6rem,6.1vw,4.6rem)] leading-[1.1] font-semibold tracking-[-0.055em]">
            {t.title}
          </h1>
          <p className="mt-5 max-w-[39rem] text-base leading-relaxed text-muted-foreground sm:text-lg">{t.lead}</p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <a href="#demo" className={buttonVariants({ size: 'lg', className: 'h-10 px-4' })}>
              <Play aria-hidden="true" />
              {t.try}
            </a>
            <Link href={href(lang, '/docs')} className={buttonVariants({ variant: 'outline', size: 'lg', className: 'h-10 px-4' })}>{t.docs}</Link>
          </div>
        </div>

        <div id="install" className="min-w-0">
          <h2 className="mb-3 text-sm font-semibold">{t.install}</h2>
          <InstallCommand lang={lang} />
          <Link href={`${guide}#install`} className="mt-3 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{t.guide}</Link>
        </div>
      </section>

      <section id="demo" aria-labelledby="demo-title" className="overflow-hidden rounded-xl border bg-card">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-5">
          <h2 id="demo-title" className="flex items-center gap-2 text-sm font-medium">
            <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
            {t.demo}
          </h2>
          <a href="#why" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{t.skipDemo}</a>
        </div>
        <Demo lang={lang} />
      </section>

      <section id="why" aria-labelledby="why-title" className="py-13 sm:py-18">
        <h2 id="why-title" className="section-heading">{t.features}</h2>
        <ul className="mt-5 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, [lang]: [title, description] }) => (
            <li key={title} className="bg-background p-5 sm:p-6">
              <Icon aria-hidden="true" className="mb-3 size-5 text-muted-foreground" />
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="examples" aria-labelledby="examples-title" className="border-t py-13 sm:py-18">
        <h2 id="examples-title" className="section-heading">{t.examples}</h2>
        <p className="mt-2 mb-5 text-muted-foreground">{t.exampleLead}</p>
        <Gallery lang={lang} />
      </section>

      <section id="docs" aria-labelledby="docs-title" className="border-t py-13 sm:py-18">
        <h2 id="docs-title" className="section-heading">{t.resources}</h2>
        <ul className="mt-5 grid gap-3 sm:grid-cols-3">
          {t.links.map(([label, description, target]) => {
            const content = <><span className="block font-medium">{label}</span><span className="mt-1 block text-sm text-muted-foreground">{description}</span></>;
            const className = 'block h-full rounded-lg border p-4 transition-colors hover:bg-muted';
            return (
              <li key={label}>
                {target.startsWith('/') ? <Link href={href(lang, target)} className={className}>{content}</Link> : <a href={target} className={className}>{content}</a>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
