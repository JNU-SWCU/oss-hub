import { ApiError } from '@/lib/api-client';

import { fetchAdminAccessHistory } from './admin-access-api';
import type { AdminAccessDetail, AdminAccessHistory } from './admin-access-api';
import {
  fetchCanonicalAdminAccessDetail,
  type CanonicalAdminAccessDetail,
} from './independent-authority-api';

/**
 * `/dashboard/users/[userId]` 직접 진입 상세(PR04E)의 fetch/파생 로직.
 * `admin-access-api.ts`(PR04B)의 `fetchAdminAccessDetail`·`fetchAdminAccessHistory`를
 * 그대로 쓰고, 이 파일은 두 호출의 조합·404 판별·화면 전용 파생값(가드·
 * 페이지 수)만 더한다. `public-profile-api.ts`의 `loadPublicProfile` 404 판별
 * 패턴을 따른다.
 */

/** `RolesErrorCode.USER_NOT_FOUND` in `apps/backend/src/roles/roles-error-code.enum.ts`. */
const USER_NOT_FOUND_CODE = 'ROL_010';

/** 요청/로그인 이력 각각 첫 페이지만 불러오며, 한도는 목록 화면과 같은 20건이다. 이후 페이지 이동도 같은 한도를 쓴다. */
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
  /** 대기 중인 요청이 있어 역할·상태 컨트롤 전체가 막혔을 때의 안내문. 없으면 `null`. */
  readonly controlBlockedReason: string | null;
  /** 본인 계정이라 비활성화 선택지가 막혔을 때의 안내문. 없으면 `null`. */
  readonly deactivationBlockedReason: string | null;
  /** 프로필 미완료라 교직원·관리자 선택지가 막혔을 때의 안내문. 없으면 `null`. */
  readonly elevatedRoleBlockedReason: string | null;
}

/**
 * 접근 변경 카드의 화면 전용 가드 — 백엔드는 이 중 어느 것도 별도 필드로
 * 내려주지 않으므로 이미 응답에 있는 `pendingRequest`·`isSelf`·
 * `profile.isComplete`에서 읽기 전용으로 계산한다.
 *
 * `elevatedRoleBlockedReason`은 백엔드 정책보다 보수적이다 — 백엔드는
 * 대기 요청을 승인할 때만 프로필 완료를 요구하고(`admin-access-transition-table.ts`의
 * `requiresCompleteProfile: requestEffect === 'APPROVED'`) 직접 역할 부여에는
 * 이 조건이 없다. 그래도 프로필이 없는 사람에게 교직원·관리자를 직접
 * 부여하는 흐름은 굳이 열어 둘 이유가 없어, 프런트에서 먼저 막는다(모든
 * 쓰기는 여전히 서버에서 검증된다).
 */
export function deriveAdminAccessGuards(
  detail: AdminAccessDetail,
): AdminAccessGuards {
  return {
    controlBlockedReason: detail.pendingRequest
      ? '대기 중인 요청을 먼저 처리해 주세요.'
      : null,
    deactivationBlockedReason: detail.isSelf
      ? '자기 계정은 비활성화할 수 없습니다.'
      : null,
    elevatedRoleBlockedReason: detail.profile.isComplete
      ? null
      : '프로필(이름·학번·학과) 완성 전에는 부여할 수 없습니다.',
  };
}

/** 요청/로그인 이력 한 페이지의 응답 shape — 둘 다 같은 모양이라 페이지 수 계산을 공유한다. */
export interface AdminAccessHistoryPage {
  readonly limit: number;
  readonly total: number;
}

/**
 * `total`이 실제 DB 카운트로 응답에 담겨 오므로(`admin-access-history-response.dto.ts`)
 * hasNext 추론 없이 바로 페이지 수를 계산한다. `total`이 0이어도 최소 1페이지로
 * 본다 — "0 / 0 페이지" 같은 표시를 피하기 위해서다.
 */
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
