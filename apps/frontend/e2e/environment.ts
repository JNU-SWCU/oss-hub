const DEFAULT_FRONTEND_PORT = 3300;
const DEFAULT_BACKEND_PORT = 4300;
const DEFAULT_SESSION_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const LEGACY_CONTRACTS = {
  users: '/api/v1/users',
  staffRequests: '/api/v1/role-requests',
} as const;

// PR04 통합 경로는 `users/access`(목록·facets)와 `users/:id/access`(상세·이력·PATCH)
// 두 형태를 모두 갖는다. 어느 쪽도 프런트엔드가 호출하지 않아야 한다.
const UNIFIED_ACCESS_PATTERN = /^\/api\/v1\/users(?:\/[^/]+)?\/access(?:\/|$)/;

type BrokenLegacyContract = 'users' | 'staff-requests' | null;

function positivePort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return value;
}

function brokenLegacyContract(): BrokenLegacyContract {
  const value = process.env.E2E_BREAK_LEGACY_CONTRACT;
  if (value === undefined || value === '') {
    return null;
  }
  if (value === 'users' || value === 'staff-requests') {
    return value;
  }
  throw new Error('E2E_BREAK_LEGACY_CONTRACT must be users or staff-requests.');
}

const frontendPort = positivePort('E2E_FRONTEND_PORT', DEFAULT_FRONTEND_PORT);

export const e2eEnvironment = Object.freeze({
  frontendPort,
  backendPort: positivePort('E2E_BACKEND_PORT', DEFAULT_BACKEND_PORT),
  baseUrl: `http://127.0.0.1:${frontendPort}`,
  sessionSecret: process.env.E2E_SESSION_SECRET ?? DEFAULT_SESSION_SECRET,
  brokenLegacyContract: brokenLegacyContract(),
  legacyContracts: LEGACY_CONTRACTS,
  isUnifiedAccessPath: (pathname: string): boolean =>
    UNIFIED_ACCESS_PATTERN.test(pathname),
});
