/** @type {import('next').NextConfig} */
export default {
  // harfbuzzjs(Emscripten)는 Node에서만 `import("module")`을 부른다. Turbopack은 브라우저 묶음에서도 그 모듈을 찾으므로 빈 모듈로 둔다
  turbopack: { resolveAlias: { module: { browser: './lib/empty-module.js' } } },
  webpack: (config, { isServer }) => {
    if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, module: false };
    return config;
  },
};
