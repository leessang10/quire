import { Terminal } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Lang } from '@/lib/i18n';
import CopyButton from './CopyButton';

const INSTALLERS = [
  ['npm', 'npm install'],
  ['pnpm', 'pnpm add'],
  ['yarn', 'yarn add'],
  ['bun', 'bun add'],
] as const;

export default function InstallCommand({ lang }: { lang: Lang }) {
  const ko = lang === 'ko';
  return (
    <Tabs defaultValue="npm" className="gap-0 overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex items-center gap-2 border-b px-3.5 sm:px-4">
        <Terminal aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <TabsList variant="line" aria-label={ko ? '패키지 매니저' : 'Package manager'} className="h-10!">
          {INSTALLERS.map(([name]) => <TabsTrigger key={name} value={name} className="px-2">{name}</TabsTrigger>)}
        </TabsList>
      </div>
      {INSTALLERS.map(([name, command]) => {
        const text = `${command} @quiredoc/core @quiredoc/react @quiredoc/fonts`;
        return (
          <TabsContent key={name} value={name} className="flex min-w-0 items-start gap-1 p-3 pl-4">
            <code className="min-w-0 flex-1 py-1.5 text-sm leading-6 [overflow-wrap:anywhere]">{text}</code>
            <CopyButton text={text} label={ko ? '설치 명령' : 'install command'} ui={lang} />
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
