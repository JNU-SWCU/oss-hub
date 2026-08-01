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

const LOCAL_REVIEW_TARGETS = new Set([
  '/',
  '/dashboard',
  '/staff/dashboard',
  '/admin/audit-log',
  '/settings',
  '/onboarding/role',
]);

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
    input.targetParam !== null && LOCAL_REVIEW_TARGETS.has(input.targetParam)
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
