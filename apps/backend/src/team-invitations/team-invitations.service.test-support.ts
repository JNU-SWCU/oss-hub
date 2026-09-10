import { TeamInvitationStatus } from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type {
  AcceptInvitationOnOk,
  SentTeamInvitationRecord,
} from './team-invitations.repository';
import { TeamInvitationsRepository } from './team-invitations.repository';
import { TeamInvitationsService } from './team-invitations.service';

export const syntheticGithubId = 424242n;
export const syntheticUserId = 'cuid-synthetic-invitee';
export const syntheticLeaderId = 'cuid-synthetic-leader';
export const syntheticTeamId = 'cuid-synthetic-team';
export const syntheticProgramId = 'cuid-synthetic-program';
export const syntheticTeamName = '합성 팀';
export const syntheticProgramName = '합성 프로그램';

export const syntheticInviteeProjection = {
  id: syntheticUserId,
  nickname: 'synthetic-invitee',
  name: '합성 초대 대상',
  avatarUrl: 'https://example.invalid/avatar.png',
} as const;

export function sentInvitationRecord(
  overrides: Partial<SentTeamInvitationRecord> = {},
): SentTeamInvitationRecord {
  return {
    id: 'cuid-invitation',
    teamId: syntheticTeamId,
    programId: syntheticProgramId,
    inviteeId: syntheticUserId,
    invitedById: syntheticLeaderId,
    status: TeamInvitationStatus.PENDING,
    invitedAt: new Date('2026-08-01T00:00:00.000Z'),
    respondedAt: null,
    invitee: { ...syntheticInviteeProjection },
    ...overrides,
  };
}

/**
 * repository의 현재 계약만 흉내 낸다 — 쓰기 경로는 예외가 아니라 판별 outcome을
 * 돌려주고, 신청 제출 여부(`locked`)로 팀 구성을 막는 열은 더 이상 없다.
 */
export type MockRepository = TeamInvitationsRepository & {
  findUserIdByGithubId: jest.Mock;
  findByInviteeId: jest.Mock;
  findByTeamId: jest.Mock;
  findTeamContext: jest.Mock;
  isTeamMember: jest.Mock;
  getInviteeEligibility: jest.Mock;
  searchCandidates: jest.Mock;
  createInvitation: jest.Mock;
  cancelPendingInvitationAsLeader: jest.Mock;
  declinePendingInvitationAsInvitee: jest.Mock;
  withAcceptTransaction: jest.Mock;
};

export function buildService(
  overrides: Partial<MockRepository> = {},
  auditLog?: Pick<AuditLogService, 'record'>,
): {
  readonly service: TeamInvitationsService;
  readonly repository: MockRepository;
  readonly auditLog: Pick<AuditLogService, 'record'>;
} {
  const repository = {
    findUserIdByGithubId: jest.fn().mockResolvedValue(syntheticUserId),
    findByInviteeId: jest.fn().mockResolvedValue([]),
    findByTeamId: jest.fn().mockResolvedValue([]),
    findTeamContext: jest.fn().mockResolvedValue({
      teamId: syntheticTeamId,
      programId: syntheticProgramId,
      leaderId: syntheticLeaderId,
      teamMaxSize: 4,
    }),
    isTeamMember: jest.fn().mockResolvedValue(true),
    getInviteeEligibility: jest.fn().mockResolvedValue('eligible'),
    searchCandidates: jest.fn().mockResolvedValue([]),
    createInvitation: jest
      .fn()
      .mockResolvedValue({ kind: 'ok', invitation: sentInvitationRecord() }),
    cancelPendingInvitationAsLeader: jest
      .fn()
      .mockResolvedValue({ kind: 'ok' }),
    declinePendingInvitationAsInvitee: jest
      .fn()
      .mockResolvedValue({ kind: 'ok' }),
    // 실제 트랜잭션처럼 성공 지점에서만 onOk(감사 기록)를 부른다.
    withAcceptTransaction: jest.fn(
      async (
        _invitationId: string,
        _inviteeId: string,
        _now?: Date,
        onOk?: AcceptInvitationOnOk,
      ) => {
        await onOk?.(
          { auditLogWriter: {} as never },
          {
            teamId: syntheticTeamId,
            programId: syntheticProgramId,
            teamName: syntheticTeamName,
            programName: syntheticProgramName,
          },
        );
        return {
          kind: 'ok',
          teamId: syntheticTeamId,
          programId: syntheticProgramId,
        };
      },
    ),
    ...overrides,
  } as unknown as MockRepository;
  const resolvedAuditLog = auditLog ?? { record: jest.fn() };
  return {
    service: new TeamInvitationsService(
      repository,
      resolvedAuditLog as AuditLogService,
    ),
    repository,
    auditLog: resolvedAuditLog,
  };
}
