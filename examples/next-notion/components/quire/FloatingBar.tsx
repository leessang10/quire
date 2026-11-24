'use client';
/** 떠 있는 서식 막대 (Notion식): 글을 고르면 선택 위에 뜬다. 텍스트 유형, 굵게·기울임·밑줄·취소선, 링크, 색, 댓글 */
import { useEffect, useState, type ReactNode } from 'react';
import { Baseline, Bold, ChevronDown, Italic, Link2, MessageSquare, Strikethrough, Underline } from 'lucide-react';
import type { QuireController } from '@quiredoc/react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Act } from '@/lib/use-ui';
import { COLORS, HIGHLIGHTS, type Ui } from '@/lib/quire-app';
import { useT } from '@/lib/i18n';
import type { AppMessageKey } from '@/lib/messages';

const keep = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

/** 텍스트 유형 (Notion의 "Turn into") */
export const BLOCK_TYPES: Array<{ id: string; label: AppMessageKey; run: Parameters<Act>[0] }> = [
  { id: 'body', label: 'block.text', run: (e) => e.setParagraphStyle('body') },
  { id: 'h1', label: 'block.h1', run: (e) => e.setParagraphStyle('h1') },
  { id: 'h2', label: 'block.h2', run: (e) => e.setParagraphStyle('h2') },
  { id: 'h3', label: 'block.h3', run: (e) => e.setParagraphStyle('h3') },
  { id: 'bullet', label: 'block.bullet', run: (e) => e.toggleList('bullet') },
  { id: 'number', label: 'block.number', run: (e) => e.toggleList('number') },
  { id: 'quote', label: 'block.quote', run: (e) => e.setParagraphStyle('quote') },
];

function T({ label, pressed, onClick, children }: { label: string; pressed?: boolean | null; onClick: () => void; children: ReactNode }) {
  return (
    <Toggle size="sm" aria-label={label} title={label} pressed={!!pressed} onPressedChange={() => onClick()} {...keep} className="h-7 min-w-7 px-1.5">
      {children}
    </Toggle>
  );
}

export function FloatingBar({ ctl, ui, version, act, onLink, onComment, hidden }: { ctl: QuireController; ui: Ui | null; version: number; act: Act; onLink: () => void; onComment: () => void; hidden: boolean }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const t = useT();
  // 선택 위치: 상태가 바뀔 때와 스크롤할 때
  useEffect(() => {
    const h = ctl.handle;
    if (!h || !ui?.hasSelection || hidden) return setPos(null);
    const place = () => {
      const { anchor, head } = h.getState().selection;
      const rects = h.rangeRects(Math.min(anchor, head), Math.max(anchor, head));
      const r = rects[0];
      setPos(r ? { x: Math.max(8, r.x), y: Math.max(8, r.y - 46) } : null);
    };
    place();
    const sc = h.editor.scrollElement;
    sc.addEventListener('scroll', place, { passive: true });
    return () => sc.removeEventListener('scroll', place);
  }, [ctl, ui, version, hidden]);
  if (!pos || !ui) return null;
  const m = ui.marks;
  const type = ui.para.list ?? ui.para.style ?? 'body';
  return (
    <div role="toolbar" aria-label={t('toolbar.label')} className="fixed z-40 flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-lg" style={{ left: pos.x, top: pos.y }}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" {...keep} />}>
          {t(BLOCK_TYPES.find((b) => b.id === type)?.label ?? 'block.text')}
          <ChevronDown className="size-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48" finalFocus={false}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('float.turnInto')}</DropdownMenuLabel>
            {BLOCK_TYPES.map((b) => (
              <DropdownMenuItem key={b.id} onClick={() => act(b.run)}>
                {t(b.label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="mx-0.5 h-5!" />
      <T label={t('attr.bold')} pressed={m.bold} onClick={() => act((e) => e.toggleMark('bold'))}>
        <Bold />
      </T>
      <T label={t('attr.italic')} pressed={m.italic} onClick={() => act((e) => e.toggleMark('italic'))}>
        <Italic />
      </T>
      <T label={t('attr.underline')} pressed={m.underline} onClick={() => act((e) => e.toggleMark('underline'))}>
        <Underline />
      </T>
      <T label={t('attr.strike')} pressed={m.strike} onClick={() => act((e) => e.toggleMark('strike'))}>
        <Strikethrough />
      </T>
      <T label={t('toolbar.link')} pressed={!!m.link} onClick={onLink}>
        <Link2 />
      </T>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('float.color')} className="size-7" {...keep} />}>
          <Baseline style={{ color: m.color ?? undefined }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52" finalFocus={false}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('float.textColor')}</DropdownMenuLabel>
            <div className="grid grid-cols-8 gap-1 px-1.5 pb-1.5">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} {...keep} onClick={() => act((e) => e.setMark('color', c === '#000000' ? undefined : c))} className={cn('size-5 rounded border', m.color === c && 'ring-2 ring-ring')} style={{ background: c }} />
              ))}
            </div>
            <DropdownMenuLabel>{t('float.background')}</DropdownMenuLabel>
            <div className="grid grid-cols-8 gap-1 px-1.5 pb-1.5">
              {HIGHLIGHTS.map((c) => (
                <button key={c} type="button" aria-label={c} {...keep} onClick={() => act((e) => e.setMark('highlight', c))} className={cn('size-5 rounded border', m.highlight === c && 'ring-2 ring-ring')} style={{ background: c }} />
              ))}
            </div>
            <DropdownMenuItem onClick={() => act((e) => (e.setMark('color', undefined), e.setMark('highlight', undefined)))}>{t('float.default')}</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="mx-0.5 h-5!" />
      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" {...keep} onClick={onComment}>
        <MessageSquare /> {t('notion.comment')}
      </Button>
    </div>
  );
}
