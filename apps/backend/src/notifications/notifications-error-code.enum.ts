import type { ErrorCode } from '../common/error-code';

export enum NotificationsErrorCode {
  STAFF_ONLY = 'NOT_001',
  USER_NOT_FOUND = 'NOT_002',
}

export const NOTIFICATIONS_ERROR_CODES: Record<
  NotificationsErrorCode,
  ErrorCode
> = {
  [NotificationsErrorCode.STAFF_ONLY]: {
    code: NotificationsErrorCode.STAFF_ONLY,
    status: 403,
    message: '교직원만 알림 설정을 변경할 수 있습니다.',
  },
  [NotificationsErrorCode.USER_NOT_FOUND]: {
    code: NotificationsErrorCode.USER_NOT_FOUND,
    status: 404,
    message: '사용자를 찾을 수 없습니다.',
  },
};
