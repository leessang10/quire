// 브라우저 묶음에서 Node 내장 모듈 `module` 자리 (next.config.mjs)
export const createRequire = () => () => {
  throw new Error("module: 브라우저에서는 쓰지 않는다");
};
export default {};
