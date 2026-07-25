/**
 * 설정 화면이 쓰는 알림 채널 API.
 * notifications feature 내부를 import하지 않고 api-client 계약만 공유한다
 * (docs/rules/frontend.md — feature 간 직접 의존 금지).
 */
import { ApiError, apiClient } from '@/lib/api-client';

export interface NotificationChannelSettings {
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
}

export interface UpdateNotificationChannelRequest {
  readonly notificationEmail: string;
  readonly notifyEnabled: boolean;
}

export type NotificationChannelApiErrorKind =
  'unauthorized' | 'forbidden' | 'not-found' | 'generic';

export class NotificationChannelResponseError extends Error {
  constructor() {
    super('알림 설정 API 응답 형식이 올바르지 않습니다.');
    this.name = 'NotificationChannelResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSettings(value: unknown): NotificationChannelSettings {
  if (
    !isRecord(value) ||
    (value.notificationEmail !== null &&
      typeof value.notificationEmail !== 'string') ||
    typeof value.notifyEnabled !== 'boolean'
  ) {
    throw new NotificationChannelResponseError();
  }
  return {
    notificationEmail: value.notificationEmail,
    notifyEnabled: value.notifyEnabled,
  };
}

export async function getMyNotificationChannel(
  signal?: AbortSignal,
): Promise<NotificationChannelSettings> {
  return parseSettings(
    await apiClient<unknown>(
      'users/me/notification-email',
      signal ? { signal } : undefined,
    ),
  );
}

export async function updateMyNotificationChannel(
  request: UpdateNotificationChannelRequest,
): Promise<NotificationChannelSettings> {
  return parseSettings(
    await apiClient<unknown>('users/me/notification-email', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}

export function classifyNotificationChannelApiError(
  error: unknown,
): NotificationChannelApiErrorKind {
  if (!(error instanceof ApiError)) {
    return 'generic';
  }
  if (error.problem.status === 401) {
    return 'unauthorized';
  }
  if (error.problem.status === 403 && error.problem.code === 'NOT_001') {
    return 'forbidden';
  }
  if (error.problem.status === 404) {
    return 'not-found';
  }
  return 'generic';
}
