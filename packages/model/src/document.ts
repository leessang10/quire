/**
 * 여러 스토리를 가진 문서 (11 §2.5): 본문 + 이름 붙은 스토리들 (표 셀, 3단계에 머리말·각주·글상자).
 *
 * 스토리마다 지금의 Doc을 그대로 쓴다. 본문은 보초·자리표시가 있는 모양이고, 다른 스토리는 가벼운 모양이다
 * (빈 텍스트 = 빈 문단 하나, 끝 ¶는 Loro에 없는 유령 ¶: Doc.fromRaw(…, story = true)). 실행 취소 연산은 스토리를 감싼
 * { type: 'story', story, op }로 기록하고 Document가 그 스토리에 적용한다.
 */
import { Doc, type Op, type RawChange, type SegState } from './doc';

export type StoryId = string;

const EMPTY_STATE: SegState = { order: [], hidden: [], placeholder: [], used: [] };

export class Document {
  private readonly map = new Map<StoryId, Doc>();
  private listener: ((story: StoryId | null, c: RawChange) => void) | null = null;

  /**
   * @param make 아직 없는 스토리를 만든다 (동기화 쪽은 Loro 상태에서). 기본은 빈 가벼운 스토리
   */
  constructor(
    readonly body: Doc,
    private readonly make: (id: StoryId) => Doc = (id) => Doc.fromRaw('', [], EMPTY_STATE, `${body.peer}`, true),
  ) {}

  /** 스토리 (없으면 만든다) */
  story(id: StoryId): Doc {
    let d = this.map.get(id);
    if (!d) {
      d = this.make(id);
      this.map.set(id, d);
      if (this.listener) {
        const fn = this.listener;
        d.observe((c) => fn(id, c));
      }
    }
    return d;
  }

  has(id: StoryId): boolean {
    return this.map.has(id);
  }

  /** 만든 스토리들의 ID */
  storyIds(): StoryId[] {
    return [...this.map.keys()];
  }

  /** 모든 스토리의 변경 기록 (본문은 story = null) */
  observe(fn: ((story: StoryId | null, c: RawChange) => void) | null): void {
    this.listener = fn;
    this.body.observe(fn ? (c) => fn(null, c) : null);
    for (const [id, d] of this.map) d.observe(fn ? (c) => fn(id, c) : null);
  }

  /** 연산 적용 (실행 취소·다시 하기): story 연산은 그 스토리에 */
  apply(op: Op): void {
    if (op.type === 'story') this.story(op.story).apply(op.op);
    else this.body.apply(op);
  }

  /** 스토리 연산을 실행 취소 기록용으로 감싼다 */
  static tag(story: StoryId, ops: Op[]): Op[] {
    return ops.map((op) => ({ type: 'story', story, op }));
  }
}
