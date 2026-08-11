import { apiClient } from '@/lib/api-client';
import type { PendingTeamInviteView } from './types';

/**
 * 팀 초대 조회·응답 HTTP 호출. `features/programs/team-invitation-api.ts`에 이미
 * 같은 endpoint 호출이 있지만, feature는 다른 feature의 내부 경로에 직접 의존하지
 * 않는다(`docs/rules/frontend.md`) — 그래서 대시보드가 필요로 하는 만큼만 이 파일에
 * 다시 선언한다. 두 파일이 갈라질 수 있는 중복이며, 후속 정리(공용 계약 추출)는
 * 별도 Issue로 미룬다.
 */

type TeamInvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

interface ReceivedTeamInvitation {
  readonly id: string;
  readonly teamId: string;
  readonly programId: string;
  readonly status: TeamInvitationStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTeamInvitationStatus(
  value: unknown,
): value is TeamInvitationStatus {
  return (
    value === 'PENDING' ||
    value === 'ACCEPTED' ||
    value === 'DECLINED' ||
    value === 'EXPIRED'
  );
}

function isReceivedTeamInvitation(
  value: unknown,
): value is ReceivedTeamInvitation {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.teamId) &&
    isNonEmptyString(value.programId) &&
    isTeamInvitationStatus(value.status)
  );
}

async function listReceivedTeamInvitations(): Promise<
  readonly ReceivedTeamInvitation[]
> {
  const response = await apiClient<unknown>('team-invitations/received');
  if (!Array.isArray(response) || !response.every(isReceivedTeamInvitation)) {
    throw new Error('받은 팀 초대 응답 형식이 올바르지 않습니다.');
  }
  return response;
}

/** `GET programs/:id` 응답에서 이름만 쓴다 — 실패해도 초대 자체는 막지 않는다. */
async function fetchProgramName(programId: string): Promise<string | null> {
  try {
    const response = await apiClient<unknown>(
      `programs/${encodeURIComponent(programId)}`,
    );
    return isRecord(response) && isNonEmptyString(response.name)
      ? response.name
      : null;
  } catch {
    return null;
  }
}

function isTeamDirectoryEntry(
  value: unknown,
): value is { readonly teamId: string; readonly name: string } {
  return (
    isRecord(value) &&
    isNonEmptyString(value.teamId) &&
    isNonEmptyString(value.name)
  );
}

/** `GET programs/:id/overview/teams`(공개 팀 로스터)에서 teamId→name만 뽑는다. */
async function fetchTeamNamesByProgram(
  programId: string,
): Promise<ReadonlyMap<string, string>> {
  try {
    const response = await apiClient<unknown>(
      `programs/${encodeURIComponent(programId)}/overview/teams`,
    );
    if (!Array.isArray(response) || !response.every(isTeamDirectoryEntry)) {
      return new Map();
    }
    return new Map(response.map((team) => [team.teamId, team.name]));
  } catch {
    return new Map();
  }
}

/**
 * 대기 중(PENDING)인 받은 팀 초대 + 표시용 프로그램/팀 이름. 목록 조회 자체가
 * 실패하면 던진다(호출부가 이 섹션만 접는다). 이름 보강만 실패하면 해당 항목의
 * 이름을 `null`로 남겨 초대 수락/거절은 계속 가능하게 한다.
 */
export async function fetchPendingTeamInviteViews(): Promise<
  readonly PendingTeamInviteView[]
> {
  const invitations = (await listReceivedTeamInvitations()).filter(
    (invitation) => invitation.status === 'PENDING',
  );
  if (invitations.length === 0) return [];

  const programIds = [...new Set(invitations.map((item) => item.programId))];
  const [programNames, teamNameMaps] = await Promise.all([
    Promise.all(programIds.map((id) => fetchProgramName(id))),
    Promise.all(programIds.map((id) => fetchTeamNamesByProgram(id))),
  ]);
  const programNameById = new Map(
    programIds.map((id, index) => [id, programNames[index] ?? null]),
  );
  const teamNamesByProgramId = new Map(
    programIds.map((id, index) => [id, teamNameMaps[index]]),
  );

  return invitations.map((invitation) => ({
    invitationId: invitation.id,
    teamId: invitation.teamId,
    programId: invitation.programId,
    programName: programNameById.get(invitation.programId) ?? null,
    teamName:
      teamNamesByProgramId.get(invitation.programId)?.get(invitation.teamId) ??
      null,
  }));
}

export async function acceptTeamInvitation(
  invitationId: string,
): Promise<void> {
  await apiClient<unknown>(
    `team-invitations/${encodeURIComponent(invitationId)}/accept`,
    { method: 'POST' },
  );
}

export async function declineTeamInvitation(
  invitationId: string,
): Promise<void> {
  await apiClient<unknown>(
    `team-invitations/${encodeURIComponent(invitationId)}/decline`,
    { method: 'POST' },
  );
}
