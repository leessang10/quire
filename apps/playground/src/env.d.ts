/** Vite 자산 URL 가져오기 (?url) */
declare module '*?url' {
  const url: string;
  export default url;
}

/** Vite import.meta.glob (쓰는 모양만) */
interface ImportMeta {
  glob(pattern: string, options: { query?: string; import?: string; eager: true }): Record<string, unknown>;
}
