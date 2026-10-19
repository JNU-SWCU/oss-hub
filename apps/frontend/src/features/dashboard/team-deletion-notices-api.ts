import { apiClient } from '@/lib/api-client';
import type { TeamDeletionNotice } from './types';

function isTeamDeletionNotice(value: unknown): value is TeamDeletionNotice {
  if (value === null || typeof value !== 'object') return false;
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'teamId' in value &&
    typeof value.teamId === 'string' &&
    value.teamId.length > 0 &&
    'teamName' in value &&
    typeof value.teamName === 'string' &&
    value.teamName.trim().length > 0 &&
    'programId' in value &&
    typeof value.programId === 'string' &&
    value.programId.trim().length > 0 &&
    value.programId !== '.' &&
    value.programId !== '..' &&
    'programName' in value &&
    typeof value.programName === 'string' &&
    value.programName.trim().length > 0 &&
    'message' in value &&
    (value.message === null || typeof value.message === 'string') &&
    'deletedAt' in value &&
    typeof value.deletedAt === 'string' &&
    !Number.isNaN(Date.parse(value.deletedAt))
  );
}

export async function fetchUnreadTeamDeletionNotices(): Promise<
  readonly TeamDeletionNotice[]
> {
  const response = await apiClient<unknown>(
    'users/me/notifications/team-deletions',
  );
  if (!Array.isArray(response) || !response.every(isTeamDeletionNotice)) {
    throw new TypeError('팀 삭제 알림 응답 형식이 올바르지 않습니다.');
  }
  return response;
}

export async function markTeamDeletionNoticeRead(
  notificationId: string,
): Promise<void> {
  await apiClient<unknown>(
    `users/me/notifications/team-deletions/${encodeURIComponent(notificationId)}/read`,
    { method: 'PATCH' },
  );
}
