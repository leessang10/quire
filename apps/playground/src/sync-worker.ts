/** 동기화 Worker: Loro 문서·내보내기·가져오기·프레즌스·네트워크를 메인 스레드 밖에서 처리한다 (09 §8) */
import { serveSyncWorker } from '@quiredoc/sync';

serveSyncWorker(self as unknown as Parameters<typeof serveSyncWorker>[0]);
