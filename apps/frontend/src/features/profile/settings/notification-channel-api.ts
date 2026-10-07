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
