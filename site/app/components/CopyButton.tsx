'use client';
import { useState } from 'react';

export default function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // 클립보드를 못 쓰는 환경: 아무것도 하지 않는다
        }
      }}
    >
      {done ? '복사함' : '복사'}
    </button>
  );
}
