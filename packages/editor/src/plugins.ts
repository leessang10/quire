/**
 * 플러그인 API (15 §7, 00 §4의 맨 위 층): 편집기 코어를 고치지 않고 기능을 덧붙인다. 플러그인은 좁은 PluginContext만 받는다:
 * 문서 읽기, 선택, 트랜잭션(편집기의 편집 경로: 실행 취소·동기화·제안 기록·권한을 그대로 탄다), 좌표, 다시 그리기, 이벤트.
 * 문서 상태를 바꾸는 길은 트랜잭션 하나뿐이라 읽기 전용·제안 모드가 플러그인에도 적용된다.
 * 찾기(find-plugin)와 맞춤법(spell-plugin)이 이 API만으로 다시 짠 내장 플러그인이다.
 */
import type { Doc, Document, Op } from '@quire/model';
import type { Translate } from './i18n';

/** 스토리 안의 자리 (story null = 본문) */
export interface StoryPos {
  story: string | null;
  offset: number;
}

/** 화면 사각형 (뷰포트 좌표, px) */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 장식 (15 §2): 저장·동기화·실행 취소에 들어가지 않는 범위. 오프셋은 그 스토리의 화면 오프셋 */
export interface Decoration {
  from: number;
  to: number;
  /** 'find' | 'find-current' | 'spell-spelling' | 'spell-spacing' | 'spell-grammar' | 플러그인이 정한 종류 */
  kind: string;
  data?: unknown;
}

/** 장식 소스가 받는 문단 (그 스토리의 오프셋 start, ¶를 뺀 글자 text, 문단 ID) */
export interface DecorationPara {
  readonly id: string;
  readonly start: number;
  readonly text: string;
}

/** 장식 소스: 그리기마다 보이는 문단마다 부른다. 시작 순, 그 문단 안의 범위만 */
export interface DecorationSource {
  decorationsIn(story: string | null, para: DecorationPara): readonly Decoration[] | null | undefined;
}

/** 장식 겉모양: 바탕은 글자 아래, 물결·밑줄은 글자 위 */
export interface DecorationStyle {
  fill?: string;
  wave?: string;
  underline?: string;
}

/** 오른쪽 클릭 메뉴 항목 (앱이 그린다) */
export interface MenuItem {
  label: string;
  /** 고르면 */
  run(): void;
  /** 흐리게 (고를 수 없음) */
  disabled?: boolean;
  /** 앞에 구분선 */
  separator?: boolean;
  /** 어느 플러그인의 것 */
  plugin?: string;
}

/** 내보내기 형식 (15 §6): 지금 문서 → 파일 */
export interface Exporter {
  /** 메뉴 이름. 함수면 지금 화면 언어로 (18) */
  label: string | ((t: Translate) => string);
  /** 파일 확장자 (점 없이) */
  extension: string;
  mime: string;
  export(ctx: PluginContext): Promise<Uint8Array | string> | Uint8Array | string;
}

export type PluginEvent = 'change' | 'selection' | 'beforeRender' | 'afterRender';

/** 플러그인이 받는 편집기의 좁은 면 */
export interface PluginContext {
  /** 플러그인 이름 */
  readonly name: string;
  /** 문서 (읽기만. 바꾸려면 edit·editDocument) */
  document(): Document;
  /** 편집 중인 스토리 (null = 본문)와 그 Doc */
  story(): string | null;
  doc(): Doc;
  /** 선택 영역 (편집 중인 스토리의 화면 오프셋). from ≤ to */
  selection(): { anchor: number; head: number; from: number; to: number; story: string | null };
  /** 편집 중인 스토리에서 선택한다 */
  select(anchor: number, head?: number): void;
  /** 그 스토리로 들어가(셀·각주·머리말) 범위를 고르고 보이게 스크롤한다. 못 들어가면 false */
  reveal(story: string | null, from: number, to: number): boolean;
  /** 글자를 바꿀 수 있는가 (읽기 전용 보기·보기·댓글 역할이면 아니다) */
  canEdit(): boolean;
  /**
   * 트랜잭션: 편집 중인 스토리 Doc에 연산을 만들어 돌려준다 (Doc의 insertText·deleteRange·format·setParaAttr 등).
   * 실행 취소 한 단계, 동기화, 제안 모드의 제안 기록을 탄다. 바꿀 수 없으면 fn을 부르지 않고 false
   */
  edit(fn: (doc: Doc) => Op[], opts?: { select?: [number, number] }): boolean;
  /** 여러 스토리에 걸친 트랜잭션 (Document 연산, 스토리 꼬리표가 붙은 것: 모두 바꾸기). 실행 취소 한 단계 */
  editDocument(fn: (document: Document) => Op[], opts?: { select?: [number, number] }): boolean;
  /** 캐럿 사각형 (뷰포트 좌표). 화면 밖이면 null */
  caretRect(): Rect | null;
  /** 편집 중인 스토리의 범위 사각형들 (줄마다, 뷰포트 좌표) */
  rangeRects(from: number, to: number): Rect[];
  /** 화면 점의 스토리 자리 (편집 중인 스토리 안이 아니면 null) */
  hitTest(clientX: number, clientY: number): StoryPos | null;
  /** 다시 그린다 (장식 소스의 결과가 바뀌었을 때) */
  redraw(): void;
  /** 편집기 이벤트. 떼는 함수를 돌려준다 */
  on(event: PluginEvent, fn: () => void): () => void;
  /** 다른 명령 실행 */
  run(command: string, ...args: unknown[]): boolean;
  /** 이 플러그인의 문서 데이터 (정본 x.<name>, 07 §4). 없으면 undefined */
  getData<T = unknown>(): T | undefined;
  setData(value: unknown): void;
  /** 편집기의 화면 언어로 번역 (18). 메뉴 이름 등 */
  t: Translate;
}

export interface QuirePlugin {
  name: string;
  /** 명령 (editor.run(name, ...args)). 처리했으면 true */
  commands?: Record<string, (ctx: PluginContext, ...args: unknown[]) => boolean>;
  /** 단축키 → 명령 이름. 'Mod+F', 'Shift+F3', 'Mod+Alt+K' 꼴 (Mod = Ctrl, 맥은 Cmd) */
  keymap?: Record<string, string>;
  /** 장식 소스 (15 §2) */
  decorations?: (ctx: PluginContext) => DecorationSource;
  /** 장식 종류의 겉모양 */
  decorationStyles?: Record<string, DecorationStyle>;
  /** 오른쪽 클릭 메뉴 항목 (그 자리, 화면 점) */
  contextMenu?: (ctx: PluginContext, at: StoryPos, point: { clientX: number; clientY: number }) => MenuItem[];
  /** 내보내기 형식 (15 §6) */
  exporters?: Record<string, Exporter>;
  /** 문서 확장 데이터: 정본 객체의 x.<name> (07 §4) */
  data?: { schemaVersion: number; migrate?(old: unknown, from: number): unknown };
  /** 붙일 때. 정리 함수를 돌려주면 뗄 때 부른다 */
  init?(ctx: PluginContext): void | (() => void);
}

/** 단축키 문자열 → 정규형 ('mod+shift+f3' 같은) */
export function normalizeKey(spec: string): string {
  const parts = spec.split('+').map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => (p === 'ctrl' || p === 'cmd' || p === 'meta' ? 'mod' : p === 'option' ? 'alt' : p)));
  return [...['mod', 'alt', 'shift'].filter((m) => mods.has(m)), key].join('+');
}

/** 키 이벤트 → 정규형 (key가 한 글자면 code의 글자로: 한글 자판에서도 Ctrl+F) */
export function eventKey(e: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string {
  let key = e.key.toLowerCase();
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  const mods = [e.ctrlKey || e.metaKey ? 'mod' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : ''].filter(Boolean);
  return [...mods, key].join('+');
}
