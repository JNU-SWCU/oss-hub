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
  // 첫 세션 조회만 실패하고 재시도하면 성공하는 상태 — `error`는 언제 눌러도 다시
  // 실패해서, 오류 화면의 "다시 시도"가 실제로 복구로 이어지는지 아무도 볼 수 없다.
  'error-once',
  'unassigned',
  'wrong-role',
  // 역할 승인 대기 상태 — 이 페르소나가 없으면 `/onboarding/pending`을 아무도 볼 수 없다.
  'role-pending',
] as const;

export type LocalReviewFixtureId = (typeof LOCAL_REVIEW_FIXTURE_IDS)[number];

/**
 * next.config의 쿠키 조건이 쓰는 값 패턴. Next는 이 문자열을 `^…$`로 감싸 완전
 * 일치로 검사하므로(prepare-destination의 matchHas), 여기 없는 페르소나는 쿠키가
 * 있어도 어댑터로 가지 못하고 실제 backend로 새어 나간다.
 *
 * 손으로 적어 두면 id 목록과 두 곳에서 따로 관리하게 돼, 새 페르소나를 넣고 한쪽만
 * 고치는 사고가 난다. 목록에서 직접 파생시켜 그 가능성을 없앤다.
 */
export const LOCAL_REVIEW_FIXTURE_PATTERN = `(?:${LOCAL_REVIEW_FIXTURE_IDS.join(
  '|',
)})` as const;

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

// 로컬 리뷰 하네스가 지원하는 진입 host 목록. 라우트의 host 검사와 next.config.ts의
// rewrite `has` 규칙이 같은 집합을 봐야 진입부터 /api/v1 rewrite까지 계약이 끊기지 않으므로
// 여기 한 곳에서만 정의하고 정규식도 이 목록에서 파생시킨다.
//
// IPv6 loopback(`::1`)은 목록에서 뺐다. Next의 rewrite host matcher는 Host 헤더를
// `host.split(':', 1)[0]`으로 잘라 hostname을 얻는데(next/dist/shared/lib/router/utils/
// prepare-destination.js), `[::1]:3000`은 이 방식으로 복원되지 않아 rewrite가 절대 매치되지
// 않는다. 라우트에서만 허용하면 fixture cookie는 심기지만 /api/v1이 adapter로 가지 않고
// 실제 backend로 조용히 나가는 반쪽 계약이 된다 — 지원 못 하는 host는 진입부터 막는 편이 낫다.
export const LOCAL_REVIEW_LOOPBACK_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
] as const;

export const LOCAL_REVIEW_LOOPBACK_HOST_PATTERN = `(?:${LOCAL_REVIEW_LOOPBACK_HOSTNAMES.map(
  (hostname) => hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
).join('|')})`;

export function isLoopbackHostname(hostname: string): boolean {
  return LOCAL_REVIEW_LOOPBACK_HOSTNAMES.some(
    (candidate) => candidate === hostname,
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
