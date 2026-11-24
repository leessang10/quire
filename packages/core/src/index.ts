/**
 * @quiredoc/core (19 §3): 편집기가 혼자 도는 데 필요한 것을 하나로 — 문서 모델·정본 JSON·.quire 파일(model), 조판(layout),
 * 셰이핑(shaping), 편집기(editor), 한 번에 붙이기(sdk의 createEditor). 저장소 안에서는 다섯 폴더가 따로 있고, 배포할 때 이
 * 진입점 하나로 묶는다 (scripts/build-packages.mjs). 이름은 겹치지 않는다 (sdk의 core-names 시험, 19 §4.3).
 * 선택 기능은 따로: @quiredoc/react, @quiredoc/collab(협업), @quiredoc/convert, @quiredoc/pdf, @quiredoc/fonts.
 */
export * from '@quiredoc/model';
export * from '@quiredoc/layout';
export * from '@quiredoc/shaping';
export * from '@quiredoc/editor';
export * from '@quiredoc/sdk';
