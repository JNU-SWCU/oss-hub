import type {
  AdminAccessHistory,
  AdminAccessMutationResponse,
  AdminAccessStaffAccessRequestHistoryItem,
} from './admin-access-api';
import type { CanonicalAdminAccessDetail } from './independent-authority-api';
import { adminDetail } from './admin-access-detail-test-fixture';

/**
 * `admin-access-detail-post-decision.test.tsx` 전용 고정 데이터 — 대기 요청
 * 하나를 가진 상세와, 백엔드가 결정 직후 돌려주는 권위 있는 PATCH 응답.
 */

export const PENDING_REQUEST_ID = 'request-pending';

export const PENDING_DETAIL: CanonicalAdminAccessDetail = adminDetail({
  role: 'STUDENT',
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  name: '합성 대기 사용자',
  pendingRequest: {
    id: PENDING_REQUEST_ID,
    status: 'PENDING',
    createdAt: '2026-08-21T00:00:00.000Z',
  },
});

function requestHistory(
  items: readonly AdminAccessStaffAccessRequestHistoryItem[],
): AdminAccessHistory {
  return {
    staffAccessRequests: { items, page: 1, limit: 20, total: items.length },
    loginHistory: { items: [], page: 1, limit: 20, total: 0 },
  };
}

export const PENDING_HISTORY: AdminAccessHistory = requestHistory([
  {
    id: PENDING_REQUEST_ID,
    status: 'PENDING',
    rejectionReason: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: '2026-08-21T00:00:00.000Z',
  },
]);

export function decidedHistory(
  status: 'APPROVED' | 'REJECTED',
  decidedAt: string,
  decidedBy: string,
): AdminAccessHistory {
  return requestHistory([
    {
      id: PENDING_REQUEST_ID,
      status,
      rejectionReason: null,
      decidedAt,
      decidedBy,
      createdAt: '2026-08-21T00:00:00.000Z',
    },
  ]);
}

export function approvedResponse(): AdminAccessMutationResponse {
  return {
    id: 'target',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    pendingRequest: null,
    decidedRequest: { id: PENDING_REQUEST_ID, status: 'APPROVED' },
  };
}

export function rejectedResponse(): AdminAccessMutationResponse {
  return {
    id: 'target',
    role: 'STUDENT',
    accountStatus: 'ACTIVE',
    pendingRequest: null,
    decidedRequest: { id: PENDING_REQUEST_ID, status: 'REJECTED' },
  };
}

export function findButton(
  container: HTMLElement,
  label: string,
): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label,
  );
}

export function clickButton(container: HTMLElement, label: string): void {
  const button = findButton(container, label);
  if (!button) {
    throw new Error(`버튼을 찾지 못했습니다: ${label}`);
  }
  button.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
}

/** 반려 다이얼로그의 사유 칸은 비우면 확정 버튼이 막힌다 — 실제 입력을 그대로 흥낸다. */
export function typeRejectReason(container: HTMLElement, reason: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>(
    '#admin-access-reject-reason',
  );
  if (!textarea) {
    throw new Error('반려 사유 칸을 찾지 못했습니다.');
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(textarea, reason);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 마운트/클릭이 건 promise 체인이 모두 정착할 때까지 microtask를 비운다. */
export async function flush(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}
