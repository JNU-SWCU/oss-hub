import type { AuthRole } from '@/features/auth/types';
import type { UserProfile } from '@/features/profile/types';
import type { RoleSelection } from '@/features/roles/types';
import { apiPath } from '@/lib/api-client';
import type { LocalReviewFixtureId } from './fixture-contract';

/**
 * 로컬 검토 픽스처의 응답 규칙을 도메인별로 나눠 담기 위한 최소 계약.
 *
 * 규칙이 한 파일의 if 체인으로 몰려 있으면 화면이 늘 때마다 같은 자리를 고치게
 * 되고, 어떤 화면이 왜 막히는지도 읽히지 않는다. 핸들러는 자기가 아는 경로만
 * 응답하고 나머지는 `null`을 돌려 다음 핸들러에게 넘긴다.
 */
/**
 * 브라우저를 통째로 옮기는 응답. `fetch`로 부르는 경로는 JSON이면 충분하지만,
 * 로그인처럼 **링크로 전체 이동하는** 경로는 JSON을 주면 검토자가 화면 대신
 * 원시 JSON을 보게 된다 — 그런 경로는 화면으로 되돌려 보내야 한다.
 */
export type LocalReviewRedirectStatus = 303 | 307;

export type LocalReviewResponsePlan =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'delay'; readonly milliseconds: number }
  | {
      readonly kind: 'redirect';
      readonly status: LocalReviewRedirectStatus;
      /** 앱 내부 경로만 쓴다(`/`로 시작). 요청 값이 아니라 규칙이 정한 상수여야 한다. */
      readonly location: string;
    };

export interface LocalReviewContext {
  readonly fixture: LocalReviewFixtureId;
  readonly method: string;
  /** `api/v1` 접두사를 뗀 경로. 예: `programs/program-capstone/viewer` */
  readonly path: string;
  readonly searchParams: URLSearchParams;
  /** 이 페르소나의 역할. 비로그인은 `null`이고 역할 미배정도 `null`이다 */
  readonly role: AuthRole | null;
  readonly isAuthenticated: boolean;
  /**
   * 파싱된 요청 본문(JSON). 본문이 없거나(GET·DELETE) JSON이 아니면 `undefined`다.
   * 승인·반려처럼 **무엇을 눌렀는지가 본문에만 있는** 조작은 이 값을 봐야 한다 —
   * 없으면 반려를 눌러도 승인이 돌아와 검토자가 제품 버그로 오해한다.
   */
  readonly body?: unknown;
}

export type LocalReviewHandler = (
  context: LocalReviewContext,
) => LocalReviewResponsePlan | null;

/**
 * 검토 세션이 **요청 사이에** 기억해야 하는 값 전부. 한 곳에 모아 둔 이유는 아래
 * `localReviewSessionState`의 주석에 있다.
 */
export interface LocalReviewSessionState {
  /**
   * 온보딩에서 고른 역할. 고르기 전이면 `null`이다.
   *
   * 순서가 역할 → 프로필로 바뀌면서, 가입을 끝까지 걸어 보려면 "역할은 골랐고
   * 프로필은 아직 비어 있는" 상태가 필요해졌다. 선택을 기억하지 않으면 다음 화면의
   * 게이트가 아직 아무것도 고르지 않은 것으로 읽어 역할 선택 화면으로 되돌리고,
   * 정작 확인해야 할 프로필 화면에 아무도 도달하지 못한다.
   */
  selectedRole: RoleSelection | null;
  /**
   * 온보딩 중 저장한 프로필. 저장 전이면 `null`이다.
   *
   * 프로필이 마지막 단계라 저장 뒤에는 승인 대기 화면으로 넘어가야 한다. 저장을
   * 잊어버리면 그 화면의 게이트가 다시 "프로필 미완료"로 읽어 프로필 입력으로
   * 되돌리고, 검토자는 끝나지 않는 왕복을 제품 결함으로 오해한다.
   */
  savedOnboardingProfile: UserProfile | null;
  /** `error-once`에 남은 실패 횟수 — "첫 조회만 실패"는 요청 사이의 기억으로만 만들어진다. */
  errorOnceFailuresLeft: number;
  /** 직전 요청의 페르소나. 다른 페르소나를 거쳐 돌아오면 실패 예산을 다시 채운다. */
  lastRequestedFixture: LocalReviewFixtureId | null;
}

function createLocalReviewSessionState(): LocalReviewSessionState {
  return {
    selectedRole: null,
    savedOnboardingProfile: null,
    errorOnceFailuresLeft: 1,
    lastRequestedFixture: null,
  };
}

/**
 * 상태를 매다는 자리. **모듈 최상단 `let`으로 두면 안 된다.**
 *
 * Next 개발 서버는 화면을 처음 열 때 그 라우트를 그때그때 컴파일하고, 그 순간 서버
 * 모듈을 새로 평가한다. 모듈 변수에 담아 둔 값은 그때 초기값으로 돌아간다. 그래서
 * "교직원을 골랐다"는 사실이 `/onboarding/pending`을 **처음 여는 바로 그 순간**
 * 사라졌다 — `role-requests/me`가 방금까지 `PENDING`이었는데 그 화면을 처음
 * 컴파일한 직후 같은 조회가 `null`이 된다. 검토자 눈에는 골랐는데 안 골라진 것으로
 * 보이고, 가입 동선의 마지막 화면에는 아무도 도달하지 못한다.
 *
 * 두 번째 방문부터는 이미 컴파일돼 있어 멀쩡하다 — 손으로 다시 해 보면 재현되지
 * 않아 "그럴 리 없다"로 덮이기 쉬운 종류다. 되돌리지 마라.
 *
 * 모듈이 아니라 **프로세스**에 매달면 사라지지 않는다. `globalThis`는 모듈을 몇 번
 * 다시 평가하든 개발 서버 프로세스에 하나뿐이라, 새로 평가된 모듈도 앞서 담아 둔
 * 값을 그대로 집는다. 활성화 경로(`local-review/[fixture]`)와 응답 경로
 * (`local-review-api/[...path]`)가 서로 다른 라우트 번들이라 각자 다른 모듈 사본을
 * 볼 수 있다는 문제도 같이 사라진다 — 두 라우트가 하나의 상태를 본다.
 *
 * 전역 가변 상태를 두어도 되는 근거: 이 어댑터는 development + loopback + 명시
 * 플래그가 모두 맞을 때만 살아 있고(`isLocalReviewRuntime`), 검토자 한 명의 브라우저
 * 하나만 바라본다. 값이 이상하게 굳어도 개발 서버를 다시 띄우면 초기값으로 돌아간다.
 * 배포 경로에는 이 코드가 도달하지 않는다.
 */
const LOCAL_REVIEW_SESSION_STATE_KEY = '__ossHubLocalReviewSessionState';

type LocalReviewStateHost = typeof globalThis & {
  [LOCAL_REVIEW_SESSION_STATE_KEY]?: LocalReviewSessionState;
};

export function localReviewSessionState(): LocalReviewSessionState {
  const host = globalThis as LocalReviewStateHost;
  const existing = host[LOCAL_REVIEW_SESSION_STATE_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const created = createLocalReviewSessionState();
  host[LOCAL_REVIEW_SESSION_STATE_KEY] = created;
  return created;
}

/**
 * 상태를 초기값으로 되돌린다. 객체를 새로 갈아 끼우지 않고 제자리에서 덮어쓰는
 * 이유는, 이미 참조를 들고 있는 호출부가 버려진 객체에 계속 쓰는 일을 막기 위해서다.
 */
export function resetLocalReviewSessionState(): void {
  Object.assign(localReviewSessionState(), createLocalReviewSessionState());
}

export function json(status: number, body: unknown): LocalReviewResponsePlan {
  return { kind: 'json', status, body };
}

/**
 * 다른 화면으로 보낸다. 기본은 303 — 무엇으로 눌러 왔든 목적지는 GET으로 열려야
 * 하고(307은 메서드를 유지해 POST가 화면에 다시 날아간다), "여기 말고 저기를
 * 보라"는 뜻이 이 상황과 정확히 맞는다.
 */
export function redirect(
  location: string,
  status: LocalReviewRedirectStatus = 303,
): LocalReviewResponsePlan {
  return { kind: 'redirect', status, location };
}

export function problem(
  status: number,
  code: string,
  instance: string,
  detail = 'The selected local review fixture returned an error.',
): LocalReviewResponsePlan {
  return json(status, {
    type: 'about:blank',
    title: 'Local review fixture response',
    status,
    detail,
    instance,
    code,
  });
}

/** 실제 백엔드가 주는 것과 같은 코드로 404를 만든다 — 화면이 "찾을 수 없음"으로 갈리게 하려면 필요하다 */
export function notFound(code: string, path: string): LocalReviewResponsePlan {
  return problem(404, code, apiPath(path));
}

export function unauthorized(path: string): LocalReviewResponsePlan {
  return problem(401, 'AUTH_401', apiPath(path));
}

export function roleForFixture(fixture: LocalReviewFixtureId): AuthRole | null {
  switch (fixture) {
    case 'student':
    case 'settings':
    case 'wrong-role':
    // 세션 조회가 복구되고 나면 평범한 학생이다. 역할을 주지 않으면 복구 직후
    // 화면이 온보딩으로 튕겨, 복구된 결과가 아니라 가입 흐름을 보게 된다.
    case 'error-once':
      return 'STUDENT';
    case 'staff':
      return 'STAFF';
    case 'admin':
      return 'ADMIN';
    default:
      return null;
  }
}

export function isAuthenticatedFixture(fixture: LocalReviewFixtureId): boolean {
  return (
    fixture !== 'anonymous' && fixture !== 'loading' && fixture !== 'error'
  );
}

/**
 * `programs/:id/viewer` 같은 패턴에서 파라미터를 뽑는다.
 * 일치하지 않으면 `null`. 세그먼트 수가 다르면 즉시 탈락한다.
 */
export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index] as string;
    const actual = pathParts[index] as string;
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

/** GET 요청이면서 패턴에 맞을 때만 파라미터를 준다 */
export function matchGet(
  context: LocalReviewContext,
  pattern: string,
): Record<string, string> | null {
  return context.method === 'GET' ? matchPath(pattern, context.path) : null;
}

/**
 * 요청 본문을 객체로 볼 때만 레코드를 준다. 본문 없음·배열·원시값은 모두 `null`이라
 * 규칙은 "본문을 못 읽은 경우"를 한 자리에서 처리하면 된다.
 */
export function bodyRecord(
  context: LocalReviewContext,
): Record<string, unknown> | null {
  const { body } = context;
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export function bodyString(
  context: LocalReviewContext,
  key: string,
): string | null {
  const value = bodyRecord(context)?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * `null`을 보낼 수 있는 항목(마일스톤 안내·프로그램 종료일 등)을 읽는다.
 * "안 보냈다"(`undefined`)와 "비웠다"(`null`)를 구분해야 빈 값을 되돌려 줄 수 있다.
 */
export function bodyNullableString(
  context: LocalReviewContext,
  key: string,
): string | null | undefined {
  const record = bodyRecord(context);
  if (record === null || !(key in record)) return undefined;
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

export function bodyBoolean(
  context: LocalReviewContext,
  key: string,
): boolean | null {
  const value = bodyRecord(context)?.[key];
  return typeof value === 'boolean' ? value : null;
}

/**
 * 화면 계약에 있는 값일 때만 통과시킨다. 임의 문자열을 그대로 응답에 실으면
 * 파서가 거부하는 응답이 만들어져 "저장 실패"로 보인다.
 */
export function bodyEnum<T extends string>(
  context: LocalReviewContext,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = bodyString(context, key);
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function positiveIntParam(
  value: string | null,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** 조작(POST/PATCH/DELETE) 성공 응답 — 화면이 낙관적으로 갱신되도록 200을 준다 */
export function accepted(body: unknown = {}): LocalReviewResponsePlan {
  return json(200, body);
}
