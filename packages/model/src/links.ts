/**
 * 링크 주소 정제 (16 §6, R4): 가져오기·붙여넣기·내보내기 경계에서 위험한 스킴을 막는다.
 * 문서 모델에는 받은 값을 그대로 둔다 (동기화 피어마다 같은 값이어야 한다). 편집기는 링크를 열지 않으므로
 * 위험은 내보낸 파일(HTML·PDF·DOCX·HWPX)과 가져온 파일에서 온다.
 *
 * 허용: http, https, mailto, tel, 스킴 없는 주소(문서 안 #, 상대 경로). 나머지 스킴(javascript:, data:, vbscript:, file: …)은 막는다.
 */

const ALLOWED = new Set(['http', 'https', 'mailto', 'tel']);

/** 링크로 써도 되는 주소면 다듬은 주소, 아니면 null */
export function safeLink(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  // 브라우저는 스킴을 읽을 때 앞뒤 공백·제어 문자와 스킴 안의 탭·줄바꿈을 버린다 ("java\tscript:"도 javascript:)
  const trimmed = url.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
  if (!trimmed || trimmed.length > 8192) return null;
  const probe = trimmed.replace(/[\t\n\r]/g, '');
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(probe);
  if (!m) {
    // 스킴이 없다: 상대 주소·#. 다만 ':'이 '/' '?' '#'보다 앞에 오면 스킴으로 읽힐 수 있어 막는다 (예: "&#106;avascript:" 디코드 뒤)
    const colon = probe.indexOf(':');
    const stop = probe.search(/[/?#]/);
    if (colon >= 0 && (stop < 0 || colon < stop)) return null;
    return trimmed;
  }
  return ALLOWED.has(m[1]!.toLowerCase()) ? trimmed : null;
}
