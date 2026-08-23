/**
 * 직전 프런트엔드 번들(v0.6.110 / 197fd717)의 질의 직렬화와 응답 파서를 **그대로**
 * 옮겨 온 fixture다.
 *
 * bridge 배포 중에는 사용자의 브라우저에 그 번들이 남아 있다. 그것이 백엔드에 무엇을
 * 보내고 무엇을 읽는지는 우리 쪽 타입이 아니라 **그 번들의 코드**가 정한다. 그래서
 * 여기서는 지금 저장소의 타입을 재사용하지 않고 그때의 구현을 복사해 둔다 —
 * 재사용하면 우리가 계약을 바꿀 때 이 fixture가 함께 따라 움직여, 정작 증명하려던
 * "옛 번들이 여전히 읽는가"가 조용히 참이 되어 버린다.
 *
 * 원본: `apps/frontend/src/features/roles/admin-access-api.ts` @ v0.6.110
 *   - `serializeAdminAccessHistoryQuery`
 *   - `parseAdminAccessHistory`
 *
 * **bridge 전용이다.** contract PR이 dual-spelling shim을 걷어낼 때 이 파일도 함께
 * 지운다 — 그 시점에는 직전 번들이 더 이상 살아 있지 않다.
 */

export type PreviousFrontendHistoryParams = {
  readonly roleRequestPage?: number;
  readonly roleRequestLimit?: number;
  readonly loginPage?: number;
  readonly loginLimit?: number;
};

type PreviousFrontendRoleRequestItem = {
  readonly id: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  readonly rejectionReason: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly createdAt: string;
};

type PreviousFrontendLoginItem = {
  readonly id: string;
  readonly event: 'LOGIN' | 'LOGOUT';
  readonly provider: 'github';
  readonly success: boolean;
  readonly loginAt: string;
};

export type PreviousFrontendHistory = {
  readonly roleRequests: {
    readonly items: readonly PreviousFrontendRoleRequestItem[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
  readonly loginHistory: {
    readonly items: readonly PreviousFrontendLoginItem[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
};

/** 직전 번들의 `AdminAccessResponseError`에 대응한다. */
export class PreviousFrontendResponseError extends Error {
  constructor() {
    super('관리자 접근 응답 형식이 올바르지 않습니다.');
    this.name = 'PreviousFrontendResponseError';
  }
}

/** v0.6.110 `serializeAdminAccessHistoryQuery` 그대로. */
export function serializeAdminAccessHistoryQueryAsPreviousFrontend(
  params: PreviousFrontendHistoryParams,
): string {
  const search = new URLSearchParams();
  if (params.roleRequestPage !== undefined) {
    search.set('roleRequestPage', String(params.roleRequestPage));
  }
  if (params.roleRequestLimit !== undefined) {
    search.set('roleRequestLimit', String(params.roleRequestLimit));
  }
  if (params.loginPage !== undefined) {
    search.set('loginPage', String(params.loginPage));
  }
  if (params.loginLimit !== undefined) {
    search.set('loginLimit', String(params.loginLimit));
  }
  return search.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRoleRequestItem(
  value: unknown,
): value is PreviousFrontendRoleRequestItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.status === 'PENDING' ||
      value.status === 'APPROVED' ||
      value.status === 'REJECTED' ||
      value.status === 'REVOKED') &&
    (value.rejectionReason === null ||
      typeof value.rejectionReason === 'string') &&
    (value.decidedAt === null || typeof value.decidedAt === 'string') &&
    (value.decidedBy === null || typeof value.decidedBy === 'string') &&
    isNonEmptyString(value.createdAt)
  );
}

function isLoginItem(value: unknown): value is PreviousFrontendLoginItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.event === 'LOGIN' || value.event === 'LOGOUT') &&
    value.provider === 'github' &&
    typeof value.success === 'boolean' &&
    isNonEmptyString(value.loginAt)
  );
}

/** v0.6.110 `parseAdminAccessHistory` 그대로 — `roleRequests`가 없으면 던진다. */
export function parseAdminAccessHistoryAsPreviousFrontend(
  value: unknown,
): PreviousFrontendHistory {
  if (
    !isRecord(value) ||
    !isRecord(value.roleRequests) ||
    !Array.isArray(value.roleRequests.items) ||
    !value.roleRequests.items.every(isRoleRequestItem) ||
    typeof value.roleRequests.page !== 'number' ||
    typeof value.roleRequests.limit !== 'number' ||
    typeof value.roleRequests.total !== 'number' ||
    !isRecord(value.loginHistory) ||
    !Array.isArray(value.loginHistory.items) ||
    !value.loginHistory.items.every(isLoginItem) ||
    typeof value.loginHistory.page !== 'number' ||
    typeof value.loginHistory.limit !== 'number' ||
    typeof value.loginHistory.total !== 'number'
  ) {
    throw new PreviousFrontendResponseError();
  }
  return {
    roleRequests: {
      items: value.roleRequests.items.map((item) => ({ ...item })),
      page: value.roleRequests.page,
      limit: value.roleRequests.limit,
      total: value.roleRequests.total,
    },
    loginHistory: {
      items: value.loginHistory.items.map((item) => ({ ...item })),
      page: value.loginHistory.page,
      limit: value.loginHistory.limit,
      total: value.loginHistory.total,
    },
  };
}
