/**
 * 밖에서 들어온 문자열을 "이 앱 안의 주소"로 쓰기 전에 거치는 관문.
 *
 * 이런 값의 출처는 URL 쿼리와 API 응답이고 둘 다 사용자가 손댈 수 있다. 검사 없이
 * 이동에 쓰면 `?returnTo=https://evil.example` 하나로 우리 도메인에서 출발해 남의
 * 사이트에 착지하는 open redirect가 된다. 피해가 가장 큰 자리가 로그인·로그아웃
 * 동선이다 — 방금 계정을 다루던 사람이 우리 화면을 믿고 그 링크를 따라간다.
 *
 * 판정은 **허용 목록**으로 쓴다. "위험한 형태를 뺀다"가 아니라 "우리 앱 안의 절대
 * 경로만 통과시킨다"다. 막을 것을 열거하는 방식은 우회가 알려질 때마다 조건이 하나씩
 * 늘고, 빠뜨린 하나가 그대로 구멍이 된다.
 *
 * 이 모듈이 feature가 아니라 lib에 있는 이유: 원래 `features/consents/api.ts` 안에
 * 갇혀 있었는데 같은 판정이 `features/auth`의 로그아웃 복귀 주소에도 필요해졌다.
 * feature끼리 직접 import는 경계 lint가 막으므로(docs/rules/frontend.md) 두 feature가
 * 공유하는 계약은 최하위 계층으로 뺀다. 사본을 하나 더 두면 한쪽만 강화되는 날이 온다.
 */

/**
 * 상대경로를 해석해 origin이 그대로인지 보기 위한 기준점. 실제로 접속하지 않으며
 * `.invalid`는 RFC 2606이 "절대 등록되지 않는다"고 못 박은 TLD라 실존 호스트와
 * 겹칠 수 없다.
 */
const PROBE_ORIGIN = 'https://internal.invalid';

/**
 * 이 앱 안의 절대 경로인가.
 *
 * 세 겹으로 본다. 앞의 두 겹은 사람이 읽고 이유를 알 수 있는 규칙이고, 마지막 한
 * 겹은 브라우저가 실제로 어떻게 읽는지를 확인하는 검산이다.
 */
export function isInternalPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return false;
  }

  // `//evil.example`은 프로토콜 상대 URL이라 `/`로 시작하면서도 남의 호스트로 나간다.
  // 역슬래시는 URL 파서가 `/`로 되돌려 읽으므로 `/\evil.example`이 같은 일을 하고,
  // 눈으로는 내부 경로처럼 보인다 — 그래서 어디에 있든 통째로 거른다.
  if (value.startsWith('//') || value.includes('\\')) {
    return false;
  }

  try {
    // 위 두 규칙을 통과했더라도 파서가 우리와 다르게 읽는 형태가 남을 수 있다.
    // 최종 판단은 "해석해 보니 origin이 그대로인가" 하나로 못 박는다.
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * 통과하면 그 경로를, 아니면 fallback을 준다.
 *
 * 검증에 실패한 값을 예외로 올리지 않는 이유는 부르는 쪽이 대부분 화면이기 때문이다.
 * 주소창에 이상한 `returnTo`가 붙어 왔다는 이유로 화면 자체를 못 그리게 만들 일은
 * 아니다 — 조용히 안전한 기본 목적지로 되돌리면 된다.
 *
 * `fallback`은 부르는 쪽이 코드에 적어 둔 상수여야 한다. 밖에서 온 값을 fallback으로
 * 넘기면 검사한 자리로 검사받지 않은 값이 그대로 들어온다.
 */
export function toInternalPath(value: unknown, fallback: string): string {
  return isInternalPath(value) ? value : fallback;
}
