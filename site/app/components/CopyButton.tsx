'use client';
import { useState } from 'react';

/** 복사 단추. label은 무엇을 복사하는지 (스크린리더용 이름: "app/Editor.tsx 복사") */
export default function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={`${label} ${done ? '복사함' : '복사'}`}
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
