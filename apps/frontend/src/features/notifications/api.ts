import { ApiError, apiClient } from '@/lib/api-client';
import type {
  NotificationSettings,
  UpdateNotificationEmailRequest,
} from './types';

export type NotificationApiErrorKind =
  'unauthorized' | 'forbidden' | 'not-found' | 'generic';

export class NotificationSettingsResponseError extends Error {
  constructor() {
    super('알림 설정 API 응답 형식이 올바르지 않습니다.');
    this.name = 'NotificationSettingsResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSettings(value: unknown): NotificationSettings {
  if (
    !isRecord(value) ||
    (value.notificationEmail !== null &&
      typeof value.notificationEmail !== 'string') ||
    typeof value.notifyEnabled !== 'boolean'
  ) {
    throw new NotificationSettingsResponseError();
  }
  return {
    notificationEmail: value.notificationEmail,
    notifyEnabled: value.notifyEnabled,
  };
}

export async function updateMyNotificationEmail(
  request: UpdateNotificationEmailRequest,
): Promise<NotificationSettings> {
  return parseSettings(
    await apiClient<unknown>('users/me/notification-email', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}

export function classifyNotificationApiError(
  error: unknown,
): NotificationApiErrorKind {
  if (!(error instanceof ApiError)) {
    return 'generic';
  }
  if (error.problem.status === 401) {
    return 'unauthorized';
  }
  if (error.problem.status === 403) {
    return 'forbidden';
  }
  if (error.problem.status === 404) {
    return 'not-found';
  }
  return 'generic';
}
