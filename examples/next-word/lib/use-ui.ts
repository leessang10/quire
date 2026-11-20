import { useMemo, useSyncExternalStore } from 'react';
import type { QuireController } from '@quire/react';
import type { Editor } from '@quire/editor';
import { uiReader, type Ui } from './quire-app';

/** 도구 막대·메뉴가 그릴 상태 (편집기 상태 알림마다 다시 읽고, 같으면 다시 그리지 않는다) */
export function useUi(ctl: QuireController): Ui | null {
  const read = useMemo(() => uiReader(), []);
  const get = () => read((ctl.handle?.editor as Editor | undefined) ?? null);
  return useSyncExternalStore((fn) => ctl.subscribe(fn), get, get);
}

export type Act = (f: (e: Editor) => unknown) => void;

/**
 * 편집기 명령을 실행하고 편집기로 포커스를 돌려준다. 메뉴·대화상자가 닫히며 포커스를 트리거로 되돌리는 것보다
 * 늦게 돌려주려고 한 틱 미룬다
 */
export function useAct(ctl: QuireController): Act {
  return useMemo(
    () => (f) => {
      const e = ctl.handle?.editor;
      if (!e) return;
      f(e);
      setTimeout(() => e.focus(), 0);
    },
    [ctl],
  );
}
