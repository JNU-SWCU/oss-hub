import type { ErrorCode } from '../common/error-code';

export enum NotificationsErrorCode {
  STAFF_ONLY = 'NOT_001',
  USER_NOT_FOUND = 'NOT_002',
  PROGRAM_NOT_FOUND = 'NOT_003',
  DEADLINE_DISABLED = 'NOT_004',
  DEADLINE_PREVIEW_STALE = 'NOT_005',
}

export const NOTIFICATIONS_ERROR_CODES: Record<
  NotificationsErrorCode,
  ErrorCode
> = {
  [NotificationsErrorCode.STAFF_ONLY]: {
    code: NotificationsErrorCode.STAFF_ONLY,
    status: 403,
    message: '교직원만 이 작업을 수행할 수 있습니다.',
  },
  [NotificationsErrorCode.USER_NOT_FOUND]: {
    code: NotificationsErrorCode.USER_NOT_FOUND,
    status: 404,
    message: '사용자를 찾을 수 없습니다.',
  },
  [NotificationsErrorCode.PROGRAM_NOT_FOUND]: {
    code: NotificationsErrorCode.PROGRAM_NOT_FOUND,
    status: 404,
    message: '프로그램을 찾을 수 없습니다.',
  },
  [NotificationsErrorCode.DEADLINE_DISABLED]: {
    code: NotificationsErrorCode.DEADLINE_DISABLED,
    status: 409,
    message: '제출 마감 알림을 먼저 켜 주세요.',
  },
  [NotificationsErrorCode.DEADLINE_PREVIEW_STALE]: {
    code: NotificationsErrorCode.DEADLINE_PREVIEW_STALE,
    status: 409,
    message: '미리보기 대상이 만료되었거나 변경되었습니다. 다시 미리보세요.',
  },
};
