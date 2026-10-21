import { ApiError } from '@/lib/api-client';

import { fetchAdminAccessHistory } from './admin-access-api';
import type { AdminAccessDetail, AdminAccessHistory } from './admin-access-api';
import {
  fetchCanonicalAdminAccessDetail,
  type CanonicalAdminAccessDetail,
} from './independent-authority-api';

const USER_NOT_FOUND_CODE = 'ROL_010';

export const ADMIN_ACCESS_DETAIL_HISTORY_LIMIT = 20;

export class AdminAccessDetailNotFoundError extends Error {
  constructor() {
    super('사용자를 찾을 수 없습니다.');
    this.name = 'AdminAccessDetailNotFoundError';
  }
}

export class AdminAccessDetailLoadError extends Error {
  constructor() {
    super('관리자 접근 상세를 불러오지 못했습니다.');
    this.name = 'AdminAccessDetailLoadError';
  }
}

export interface AdminAccessDetailData {
  readonly detail: CanonicalAdminAccessDetail;
  readonly history: AdminAccessHistory;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.problem.status === 404 &&
    error.problem.code === USER_NOT_FOUND_CODE
  );
}

export async function loadAdminAccessDetail(
  userId: string,
  signal?: AbortSignal,
): Promise<AdminAccessDetailData> {
  try {
    const [detail, history] = await Promise.all([
      fetchCanonicalAdminAccessDetail(userId, signal),
      fetchAdminAccessHistory(
        userId,
        {
          staffAccessRequestPage: 1,
          staffAccessRequestLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
          loginPage: 1,
          loginLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
        },
        signal,
      ),
    ]);
    return { detail, history };
  } catch (error) {
    if (isNotFound(error)) {
      throw new AdminAccessDetailNotFoundError();
    }
    throw new AdminAccessDetailLoadError();
  }
}

export interface AdminAccessGuards {
  readonly controlBlockedReason: string | null;

  readonly approvalBlockedReason: string | null;

  readonly deactivationBlockedReason: string | null;

  readonly adminRevokeBlockedReason: string | null;

  readonly elevatedRoleBlockedReason: string | null;
}

export function deriveAdminAccessGuards(
  detail: AdminAccessDetail,
): AdminAccessGuards {
  return {
    controlBlockedReason: detail.pendingRequest
      ? '대기 중인 요청을 먼저 처리해 주세요.'
      : null,
    approvalBlockedReason:
      detail.accountStatus === 'DEACTIVATED'
        ? '비활성 계정은 승인할 수 없습니다. 계정이 다시 활성화된 뒤에 처리할 수 있습니다.'
        : null,
    deactivationBlockedReason: detail.isSelf
      ? '자기 계정은 비활성화할 수 없습니다.'
      : null,
    adminRevokeBlockedReason: detail.isSelf
      ? '자기 계정의 관리자 접근은 회수할 수 없습니다.'
      : null,
    elevatedRoleBlockedReason: detail.profile.isComplete
      ? null
      : '프로필(이름·학번·학과) 완성 전에는 부여할 수 없습니다.',
  };
}

export interface AdminAccessHistoryPage {
  readonly limit: number;
  readonly total: number;
}

export function adminAccessHistoryPageCount(
  page: AdminAccessHistoryPage,
): number {
  return Math.max(1, Math.ceil(page.total / page.limit));
}

export function formatAdminAccessDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
