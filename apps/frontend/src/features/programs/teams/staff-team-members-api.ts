import { apiClient } from '@/lib/api-client';

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

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
