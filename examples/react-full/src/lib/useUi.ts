import { useMemo, useSyncExternalStore } from 'react';
import type { QuireController } from '@quiredoc/react';
import type { Editor } from '@quiredoc/core';
import { uiReader, type Ui } from './quire-app';

/** 도구 막대·메뉴가 그릴 상태 (편집기 상태 알림마다 다시 읽고, 같으면 다시 그리지 않는다) */
export function useUi(ctl: QuireController): Ui | null {
  const read = useMemo(() => uiReader(), []);
  const get = () => read((ctl.handle?.editor as Editor | undefined) ?? null);
  return useSyncExternalStore((fn) => ctl.subscribe(fn), get, get);
}

/** 편집기 명령을 실행하고 편집기로 포커스를 돌려준다 */
export function useAct(ctl: QuireController) {
  return useMemo(
    () =>
      (f: (e: Editor) => unknown): void => {
        const e = ctl.handle?.editor;
        if (!e) return;
        f(e);
        e.focus();
      },
    [ctl],
  );
}
