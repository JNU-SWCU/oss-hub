export const LOCAL_REVIEW_FIXTURE_COOKIE =
  'oss_hub_local_review_fixture' as const;

export const LOCAL_REVIEW_FIXTURE_IDS = [
  'anonymous',
  'student',
  'staff',
  'admin',
  'settings',
  'loading',
  'error',
  'unassigned',
  'wrong-role',
  // 역할 승인 대기 상태 — 이 페르소나가 없으면 `/onboarding/pending`을 아무도 볼 수 없다.
  'role-pending',
] as const;

export type LocalReviewFixtureId = (typeof LOCAL_REVIEW_FIXTURE_IDS)[number];

export const LOCAL_REVIEW_FIXTURE_PATTERN =
  '(?:anonymous|student|staff|admin|settings|loading|error|unassigned|wrong-role|role-pending)' as const;

/**
 * 정확히 일치할 때만 허용하는 진입 경로. 하위 경로가 없는 화면들이다.
 */
const LOCAL_REVIEW_TARGET_PATHS = new Set([
  '/',
  '/programs',
  '/archive',
  '/dashboard',
  '/my-repos',
  '/consent',
  '/staff/dashboard',
  // 관리자 접근은 한 화면으로 합쳐졌다. 예전의 `/admin/staff-requests`·
  // `/admin/users` 를 열어 두던 자리를 `/admin/access` 가 대신한다.
  '/admin/access',
  '/admin/audit-log',
  '/admin/system-status',
  '/settings',
  '/onboarding/role',
]);

/**
 * 하위 경로까지 허용하는 접두사. `/programs/program-capstone` 같은 상세 화면은
 * id가 열려 있어 완전 일치 목록으로 적을 수 없다 — 앱 내부 경로만 넓히고,
 * 바깥으로 나가는 값은 아래 `isSafeInternalPath`에서 먼저 잘라 낸다.
 *
 * `/admin/`은 접두사로 열지 않는다. 관리자 화면은 모두 고정 경로라 위 완전 일치
 * 목록으로 충분하고, 없는 하위 경로(`/admin/console` 등)까지 통과시킬 이유가 없다.
 */
const LOCAL_REVIEW_TARGET_PREFIXES = [
  '/programs/',
  '/archive/',
  '/staff/programs/',
  '/dashboard/',
  '/onboarding/',
  '/profile/',
] as const;

/**
 * 제어문자·개행·공백은 경로에 올 수 없다 — 헤더 분리나 우회 표기의 재료가 되고,
 * URL 경로에서 공백은 인코딩(`%20`)돼 들어오지 원문으로 오지 않는다.
 */
const UNSAFE_TARGET_CHARACTER_PATTERN = /[\s\u0000-\u001F\u007F]/;

/**
 * 앱 내부 경로인지 판정한다. 접두사 허용을 도입해도 오픈 리다이렉트는 계속
 * 막혀야 하므로, 스킴·프로토콜 상대(`//`)·역슬래시·제어문자를 먼저 거른다.
 */
function isSafeInternalPath(value: string): boolean {
  return (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !UNSAFE_TARGET_CHARACTER_PATTERN.test(value)
  );
}

export function isLocalReviewTarget(value: string): boolean {
  if (!isSafeInternalPath(value)) return false;
  if (LOCAL_REVIEW_TARGET_PATHS.has(value)) return true;
  return LOCAL_REVIEW_TARGET_PREFIXES.some((prefix) =>
    value.startsWith(prefix),
  );
}

type LocalReviewRuntimeInput = {
  readonly nodeEnv: string | undefined;
  readonly enabled: string | undefined;
  readonly backendOrigin: string;
};

type LocalReviewActivationInput = LocalReviewRuntimeInput & {
  readonly requestHostname: string;
  readonly fixtureParam: string;
  readonly targetParam: string | null;
};

export type LocalReviewActivation =
  | { readonly kind: 'not-found' }
  | {
      readonly kind: 'redirect';
      readonly fixture: LocalReviewFixtureId | null;
      readonly target: string;
    };

export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export function parseRequestHostname(hostHeader: string | null): string | null {
  if (hostHeader === null) {
    return null;
  }

  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

export function parseLocalReviewFixture(
  value: string | null,
): LocalReviewFixtureId | null {
  return (
    LOCAL_REVIEW_FIXTURE_IDS.find((candidate) => candidate === value) ?? null
  );
}

export function isLocalReviewRuntime({
  nodeEnv,
  enabled,
  backendOrigin,
}: LocalReviewRuntimeInput): boolean {
  if (nodeEnv !== 'development' || enabled !== '1') {
    return false;
  }

  try {
    return isLoopbackHostname(new URL(backendOrigin).hostname);
  } catch {
    return false;
  }
}

export function createLocalReviewActivation(
  input: LocalReviewActivationInput,
): LocalReviewActivation {
  if (
    !isLocalReviewRuntime(input) ||
    !isLoopbackHostname(input.requestHostname)
  ) {
    return { kind: 'not-found' };
  }

  const target =
    input.targetParam !== null && isLocalReviewTarget(input.targetParam)
      ? input.targetParam
      : '/';

  if (input.fixtureParam === 'off') {
    return { kind: 'redirect', fixture: null, target };
  }

  const fixture = parseLocalReviewFixture(input.fixtureParam);
  return fixture
    ? { kind: 'redirect', fixture, target }
    : { kind: 'not-found' };
}
