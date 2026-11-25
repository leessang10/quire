'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { UI, type Lang } from '@/lib/i18n';

export default function CopyButton({ text, label, ui }: { text: string; label: string; ui: Lang }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  const t = UI[ui];
  const word = copied ? t.copied : t.copy;
  const description = ui === 'en' ? `${word} ${label}` : `${label} ${word}`;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <>
      <Button type="button" variant="ghost" size="icon" aria-label={description} title={description}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}>
        {copied ? <Check /> : <Copy />}
      </Button>
      <span aria-live="polite" className="sr-only">{copied ? t.copied : ''}</span>
    </>
  );
}
