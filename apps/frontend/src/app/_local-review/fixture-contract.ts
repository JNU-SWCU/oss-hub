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

export type LocalReviewFixtureId =
  (typeof LOCAL_REVIEW_FIXTURE_IDS)[number];

export const LOCAL_REVIEW_FIXTURE_PATTERN =
  '(?:anonymous|student|staff|admin|settings|loading|error|unassigned|wrong-role)' as const;

const LOCAL_REVIEW_TARGETS = new Set([
  '/',
  '/dashboard',
  '/staff/dashboard',
  '/admin/staff-requests',
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
