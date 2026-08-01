import { ApiError } from '@/lib/api-client';

import {
  fetchAdminAccessDetail,
  fetchAdminAccessHistory,
} from './admin-access-api';
import type { AdminAccessDetail, AdminAccessHistory } from './admin-access-api';

/**
 * `/admin/access/users/[userId]` 직접 진입 상세(PR04E)의 fetch/파생 로직.
 * `admin-access-api.ts`(PR04B)의 `fetchAdminAccessDetail`·`fetchAdminAccessHistory`를
 * 그대로 쓰고, 이 파일은 두 호출의 조합·404 판별·화면 전용 파생값(자격·차단
 * 사유)만 더한다. `public-profile-api.ts`의 `loadPublicProfile` 404 판별
 * 패턴을 따른다.
 */

/** `RolesErrorCode.USER_NOT_FOUND` in `apps/backend/src/roles/roles-error-code.enum.ts`. */
const USER_NOT_FOUND_CODE = 'ROL_010';

/** 요청/로그인 이력 각각 첫 페이지만 불러오며, 한도는 목록 화면과 같은 20건이다. */
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
  readonly detail: AdminAccessDetail;
  readonly history: AdminAccessHistory;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.problem.status === 404 &&
    error.problem.code === USER_NOT_FOUND_CODE
  );
}

/**
 * 상세 + 요청/로그인 이력을 병렬로 불러온다. 404(`ROL_010`)는
 * `AdminAccessDetailNotFoundError`로, 그 외 실패는 `AdminAccessDetailLoadError`로
 * 수렴한다(파싱 실패 `AdminAccessResponseError` 포함) — 화면은 이 두 타입만
 * 구분하면 된다.
 */
export async function loadAdminAccessDetail(
  userId: string,
  signal?: AbortSignal,
): Promise<AdminAccessDetailData> {
  try {
    const [detail, history] = await Promise.all([
      fetchAdminAccessDetail(userId, signal),
      fetchAdminAccessHistory(
        userId,
        {
          roleRequestPage: 1,
          roleRequestLimit: ADMIN_ACCESS_DETAIL_HISTORY_LIMIT,
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

export interface AdminAccessEligibility {
  readonly eligible: boolean;
  readonly blockedReason: string | null;
}

/**
 * 화면 전용 파생값 — 백엔드는 자격/차단 사유를 별도 필드로 내려주지 않으므로
 * 이미 응답에 있는 `accountStatus`·`profile.isComplete`에서 읽기 전용으로
 * 계산한다. 계정 비활성화를 프로필 미완료보다 먼저 본다(관리자가 가장 먼저
 * 알아야 할 차단 사유이기 때문).
 */
export function deriveAdminAccessEligibility(
  detail: AdminAccessDetail,
): AdminAccessEligibility {
  if (detail.accountStatus === 'DEACTIVATED') {
    return { eligible: false, blockedReason: '계정이 비활성화되어 있습니다.' };
  }
  if (!detail.profile.isComplete) {
    return { eligible: false, blockedReason: '프로필이 완료되지 않았습니다.' };
  }
  return { eligible: true, blockedReason: null };
}

/** 이력이 첫 페이지 한도에서 잘렸는지 — "히스토리는 bounded로 유지" 요건의 표시용 판단. */
export function isAdminAccessHistoryTruncated(page: {
  readonly items: readonly unknown[];
  readonly total: number;
}): boolean {
  return page.total > page.items.length;
}
