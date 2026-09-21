import { apiClient } from '@/lib/api-client';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

/**
 * 교직원·관리자의 팀원 제외.
 * `DELETE /programs/:programId/teams/:teamId/members/:userId` — 본문 없는 204.
 */
export function removeStaffTeamMember(
  programId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  return apiClient<void>(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

/**
 * 교직원·관리자의 팀장 변경.
 * `PATCH /programs/:programId/teams/:teamId/leader` `{ userId }` — 본문 없는 204.
 * 현재 팀장과 같은 `userId`는 서버가 204 no-op 으로 받는다.
 */
export function transferStaffTeamLeader(
  programId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  return apiClient<void>(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}/leader`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ userId }),
    },
  );
}
