/**
 * 가져오기 보고 (18 §7 L-5): 담을 수 없어 버린 요소의 종류. 보고(`dropped`)의 키이고 언어와 상관없이 고정이다.
 * 화면 이름은 메시지 키 `drop.<종류>` (`editor.t(dropMessageKey(k))`).
 */
import type { MessageKey } from './i18n';

export const DROP_KINDS = [
  'unsafeLink',
  'remoteImage',
  'unreadableImage',
  'missingImage',
  'horizontalRule',
  'embeddedDocument',
  'embeddedObject',
  'video',
  'audio',
  'svg',
  'canvas',
  'formControl',
  'equation',
  'shape',
  'vml',
  'group',
  'ole',
  'textArt',
  'chart',
  'overlappingCharacters',
  'ruby',
  'nestedTable',
  'tableOutsideBody',
  'paragraphFormatChange',
  'textFormatChange',
  'orphanFootnote',
] as const;

export type DropKind = (typeof DROP_KINDS)[number];

/** 버린 요소 → 개수 */
export type DropCounts = Partial<Record<DropKind, number>>;

export const isDropKind = (k: string): k is DropKind => (DROP_KINDS as readonly string[]).includes(k);

/** 종류의 메시지 키 */
export const dropMessageKey = (k: DropKind): MessageKey => `drop.${k}` as MessageKey;
