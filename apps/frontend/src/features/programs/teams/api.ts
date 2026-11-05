import type {
  TeamMember,
  ProgramTeam,
  StaffProgramTeam,
  StaffTeamDetail,
  RenamedTeam,
  TeamDeletionScope,
  DeletedTeamResult,
  InvitationCandidate,
} from './dto';
import { apiClient } from '@/lib/api-client';
import { isRecord } from '@/lib/is-record';
import { listTeamManagementApplications } from '../applications/api';

export function searchApplicationInvitationCandidates(
  programId: string,
  query: string,
): Promise<readonly InvitationCandidate[]> {
  const search = new URLSearchParams({ query });
  return apiClient<readonly InvitationCandidate[]>(
    `team-invitations/programs/${encodeURIComponent(programId)}/search?${search}`,
  );
}

export class ProgramTeamResponseError extends Error {
  constructor() {
    super('팀 응답 형식이 올바르지 않습니다.');
    this.name = 'ProgramTeamResponseError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTeamMember(value: unknown): value is TeamMember {
  return (
    isRecord(value) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.nickname) &&
    (value.name === null || typeof value.name === 'string') &&
    typeof value.isLeader === 'boolean'
  );
}

function parseProgramTeam(value: unknown): ProgramTeam {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    typeof value.name !== 'string' ||
    typeof value.memberCount !== 'number' ||
    !(value.minMembers === null || typeof value.minMembers === 'number') ||
    typeof value.maxMembers !== 'number' ||
    (value.status !== 'SUBMITTED' &&
      value.status !== 'APPROVED' &&
      value.status !== 'REJECTED') ||
    typeof value.canInvite !== 'boolean' ||
    typeof value.canRemoveMembers !== 'boolean' ||
    typeof value.canLeave !== 'boolean' ||
    typeof value.isLeader !== 'boolean' ||
    !Array.isArray(value.members) ||
    !value.members.every(isTeamMember)
  ) {
    throw new ProgramTeamResponseError();
  }
  return {
    id: value.id,
    name: value.name,
    memberCount: value.memberCount,
    minMembers: value.minMembers,
    maxMembers: value.maxMembers,
    status: value.status,
    canInvite: value.canInvite,
    canRemoveMembers: value.canRemoveMembers,
    canLeave: value.canLeave,
    isLeader: value.isLeader,
    members: value.members,
  };
}

export async function getMyTeam(
  programId: string,
): Promise<ProgramTeam | null> {
  const body = await apiClient<unknown>(
    `programs/${encodeURIComponent(programId)}/teams/me/membership`,
  );
  if (!isRecord(body)) throw new ProgramTeamResponseError();
  if (body.membership === 'NONE' && body.team === null) return null;
  if (body.membership !== 'MEMBER' && body.membership !== 'LEADER') {
    throw new ProgramTeamResponseError();
  }
  return parseProgramTeam(body.team);
}

export function leaveMyTeam(programId: string): Promise<void> {
  return apiClient<void>(
    `programs/${encodeURIComponent(programId)}/teams/me/membership`,
    {
      method: 'DELETE',
    },
  );
}

export function removeMyTeamMember(
  programId: string,
  userId: string,
): Promise<void> {
  return apiClient<void>(
    `programs/${encodeURIComponent(programId)}/teams/me/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export function transferMyTeamLeader(
  programId: string,
  userId: string,
): Promise<void> {
  return apiClient<void>(
    `programs/${encodeURIComponent(programId)}/teams/me/leader`,
    {
      method: 'PATCH',
      body: JSON.stringify({ userId }),
    },
  );
}

export async function listStaffProgramTeams(
  programId: string,
): Promise<readonly Pick<StaffProgramTeam, 'teamId' | 'name'>[]> {
  const teams: Pick<StaffProgramTeam, 'teamId' | 'name'>[] = [];
  let page = 1;
  let totalPages: number;
  do {
    const response = await listTeamManagementApplications(programId, {
      page,
      pageSize: 100,
      search: '',
      status: 'all',
    });
    for (const item of response.items) {
      if (item.team === null) throw new ProgramTeamResponseError();
      teams.push({ teamId: item.id, name: item.team.name });
    }
    totalPages = response.totalPages;
    page += 1;
  } while (page <= totalPages);
  return teams;
}

export async function getStaffProgramTeamDetail(
  programId: string,
  teamId: string,
): Promise<StaffTeamDetail> {
  return apiClient<StaffTeamDetail>(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`,
  );
}

export function renameProgramTeam(
  programId: string,
  teamId: string,
  name: string,
): Promise<RenamedTeam> {
  return apiClient<RenamedTeam>(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
  );
}

export function deleteStaffProgramTeam(
  programId: string,
  teamId: string,
  expectedScope: TeamDeletionScope,

  notificationMessage?: string,
): Promise<DeletedTeamResult> {
  const trimmed = notificationMessage?.trim();
  return apiClient<DeletedTeamResult>(
    `programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify(
        trimmed
          ? { expectedScope, notificationMessage: trimmed }
          : { expectedScope },
      ),
    },
  );
}
