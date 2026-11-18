/**
 * 메인 스레드 ↔ Worker 메시지 (09 §8).
 *
 * Worker는 하나의 기록 H를 만든다: 메인이 보낸 로컬 변경 묶음(ack)과 가져온 원격 변경(remote)이 들어온 차례대로.
 * 메인은 받은 H 항목 수(rev)를 세고, 로컬 변경 묶음을 한 번에 하나만 보낸다(보낸 것 + 대기열, ot.js 방식).
 * Worker는 받은 묶음을 그 rev 뒤에 쌓인 원격 항목들에 대해 변환해 적용하고, 메인은 받은 원격 항목을
 * 보낸 것 + 대기열에 대해 변환해 Doc에 적용한다. 두 쪽이 같은 변환 함수(ot.ts)를 같은 입력에 쓰므로 같은 결과가 된다.
 */
import type { ListDef, SegId, SegState, Style } from '@quire/model';
import type { LocalChange, RemoteOp } from './ot';
import type { FormatState } from './shape';

/** 스타일·목록 정의 (Loro 맵 styles·lists의 내용) */
export interface Defs {
  styles: Record<string, Style | null> | null;
  lists: Record<string, ListDef | null> | null;
}

export type ToWorker =
  /** 로컬 변경 묶음. rev: 만들 때 메인이 받은 H 항목 수. wantState: 적용 뒤 구획 상태를 ack에 실어 달라 */
  | { t: 'ops'; rev: number; changes: LocalChange[]; wantState: boolean }
  /** 묶음 처리(내보내기·가져오기)를 지금 한다 (시험·종료용) */
  | { t: 'flush' }
  /** 중계 모드: 네트워크에서 받은 문서·프레즌스 업데이트 */
  | { t: 'net'; kind: 'doc' | 'presence'; bytes: Uint8Array }
  /** hold에 대한 답: 보낸 묶음이 모두 적용되었고, 이제 reset까지 아무것도 보내지 않는다 */
  | { t: 'held' }
  | { t: 'close' };

/** 원격 피어의 선택 영역. 위치는 Worker의 Loro 기준 UTF-16 (null = 아직 풀 수 없음) */
export interface RemoteSel {
  key: string;
  name: string;
  color: string;
  anchor: number | null;
  head: number | null;
}

export type ToMain =
  /** 처음 문서 (Doc.fromRaw 입력) */
  | { t: 'init'; raw: string; keys: SegId[]; state: SegState; peer: string; formats: FormatState }
  /** H 항목: 메인이 보낸 묶음을 적용했다 (wantState면 구획 상태와 정의도) */
  | { t: 'ack'; state?: SegState; defs?: Defs }
  /** H 항목: 원격 변경. ops는 차례로 적용할 텍스트·서식 연산, state는 구획 상태가, defs는 스타일·목록 정의가 바뀌었을 때 */
  | { t: 'remote'; ops: RemoteOp[]; state?: SegState; defs?: Defs }
  /** 원격 피어들의 선택 영역 (H 항목 아님: 지금까지의 H 기준 위치) */
  | { t: 'remotes'; list: RemoteSel[] }
  /** 중계 모드: 네트워크로 보낼 업데이트 */
  | { t: 'net'; kind: 'doc' | 'presence'; bytes: Uint8Array }
  /** 새 판으로 바꾸기 전: 보낸 묶음이 끝나면 held로 답하고 로컬 변경을 보내지 말라 (09 §9) */
  | { t: 'hold' }
  /** 새 판의 문서. 메인은 Doc을 새로 만들고, held 뒤에 한 로컬 변경을 다시 적용한다. lost: 옛 판의 로컬 변경을 살리지 못함 */
  | { t: 'reset'; raw: string; keys: SegId[]; state: SegState; peer: string; formats: FormatState; lost: boolean }
  /** 연결 상태 (WebSocket 모드) */
  | { t: 'status'; online: boolean; detail?: string };
