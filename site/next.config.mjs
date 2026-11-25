/** @type {import('next').NextConfig} */
export default {
  devIndicators: false,
  // harfbuzzjs(Emscripten)는 Node에서만 `import("module")`을 부른다. 브라우저 묶음에서는 빈 모듈로 둔다
  turbopack: { resolveAlias: { module: { browser: './lib/empty-module.js' } } },
  webpack: (config, { isServer }) => {
    if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, module: false };
    return config;
  },
};
