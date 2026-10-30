import type {
  TeamMember,
  ProgramTeam,
  CreatedTeam,
  StaffProgramTeam,
  StaffTeamDetail,
  RenamedTeam,
  TeamDeletionScope,
  DeletedTeamResult,
} from './dto';
import { apiClient } from '@/lib/api-client';
import { isRecord } from '@/lib/is-record';

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
    typeof value.hasApplication !== 'boolean' ||
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
    hasApplication: value.hasApplication,
    canInvite: value.canInvite,
    canRemoveMembers: value.canRemoveMembers,
    canLeave: value.canLeave,
    isLeader: value.isLeader,
    members: value.members,
    ...(value.preparation === true ? { preparation: true } : {}),
  };
}

export async function getMyTeam(
  programId: string,
): Promise<ProgramTeam | null> {
  const body = await apiClient<unknown>(
    `programs/${encodeURIComponent(programId)}/teams/me`,
  );
  if (!isRecord(body)) throw new ProgramTeamResponseError();
  if (body.membership === 'NONE' && body.team === null) return null;
  if (body.membership !== 'MEMBER' && body.membership !== 'LEADER') {
    throw new ProgramTeamResponseError();
  }
  return parseProgramTeam(body.team);
}

export function leaveMyTeam(programId: string): Promise<void> {
  return apiClient<void>(`programs/${encodeURIComponent(programId)}/teams/me`, {
    method: 'DELETE',
  });
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

export function listStaffProgramTeams(
  programId: string,
): Promise<readonly StaffProgramTeam[]> {
  return apiClient<readonly StaffProgramTeam[]>(
    `programs/${encodeURIComponent(programId)}/teams`,
  );
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

export async function getMyApplicationPreparation(
  programId: string,
): Promise<ProgramTeam | null> {
  const body = await apiClient<unknown>(
    `application-preparations/programs/${encodeURIComponent(programId)}/me`,
  );
  return body === null ? null : parseProgramTeam(body);
}

export async function createApplicationPreparation(
  programId: string,
  input: { readonly name: string },
): Promise<CreatedTeam> {
  const body = await apiClient<unknown>(
    `application-preparations/programs/${encodeURIComponent(programId)}`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return parseProgramTeam(body);
}

export function removePreparationMember(
  programId: string,
  userId: string,
): Promise<void> {
  return apiClient<void>(
    `application-preparations/programs/${encodeURIComponent(programId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

export function leaveApplicationPreparation(programId: string): Promise<void> {
  return apiClient<void>(
    `application-preparations/programs/${encodeURIComponent(programId)}/me`,
    { method: 'DELETE' },
  );
}
