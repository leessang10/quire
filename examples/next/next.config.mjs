/** @type {import('next').NextConfig} */
export default {
  // 개발 모드 표시(왼쪽 아래 배지)를 숨긴다: 스크린샷이 실제 앱처럼 보이게
  devIndicators: false,
  // styled-components: 서버 렌더링 클래스 이름과 브라우저 클래스 이름을 맞춘다
  compiler: { styledComponents: true },
  // harfbuzzjs(Emscripten)는 Node에서만 `import("module")`을 부른다. Turbopack은 브라우저 묶음에서도 그 모듈을 찾으므로 빈 모듈로 둔다
  turbopack: { resolveAlias: { module: { browser: './lib/empty-module.js' } } },
  // webpack(`next dev --webpack`)도 같게
  webpack: (config, { isServer }) => {
    if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, module: false };
    return config;
  },
};
