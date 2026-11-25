import { Noto_Serif_KR } from 'next/font/google';

/** 본문·제목 명조 (한글 조각은 unicode-range로 필요한 만큼만 받는다). 기울임 얼굴이 없어 기울임은 쓰지 않는다 */
export const serif = Noto_Serif_KR({
  weight: ['400', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
});
