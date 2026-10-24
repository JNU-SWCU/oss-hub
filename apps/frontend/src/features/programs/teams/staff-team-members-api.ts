import { apiClient } from '@/lib/api-client';

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
      body: JSON.stringify({ userId }),
    },
  );
}
