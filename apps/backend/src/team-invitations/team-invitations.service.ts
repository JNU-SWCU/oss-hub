import { Injectable } from '@nestjs/common';
import {
  createTeamJoinedAuditMetadata,
  TEAM_JOINED_AUDIT_ACTIONS,
} from '../audit-log/audit-log-metadata';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DomainException } from '../common/error-code';
import {
  TEAM_INVITATION_ERROR_CODES,
  TeamInvitationErrorCode,
} from './team-invitation-error-code.enum';
import {
  InvitationCandidateRecord,
  PendingInvitationConflictError,
  ReceivedTeamInvitationRecord,
  TeamInvitationRecord,
  TeamInvitationLockedError,
  TeamInvitationsRepository,
} from './team-invitations.repository';

export interface AcceptedInvitationResult {
  readonly teamId: string;
  readonly programId: string;
}

/**
 * 검색으로 팀원을 찾아 초대하고, 초대받은 이가 수락/거절하는 흐름.
 * 기존 참여 코드(joinCodeDigest) 방식(programs 모듈)과 병존한다 — 이 서비스는
 * 건드리지 않는다.
 */
@Injectable()
export class TeamInvitationsService {
  constructor(
    private readonly repository: TeamInvitationsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  /** 내가 받은 초대 전부 — 팀·프로그램 요약이 함께 온다. 상태로 거르지 않는다. */
  async listReceived(
    githubId: bigint,
  ): Promise<ReceivedTeamInvitationRecord[]> {
    const userId = await this.requireUserId(githubId);
    return this.repository.findByInviteeId(userId);
  }

  /** 팀장이 자기 팀이 보낸 초대 목록을 본다. 팀 구성원이라면 누구나 볼 수 있다. */
  async listSentByTeam(
    githubId: bigint,
    teamId: string,
  ): Promise<TeamInvitationRecord[]> {
    const userId = await this.requireUserId(githubId);
    await this.requireTeamMember(teamId, userId);
    return this.repository.findByTeamId(teamId);
  }

  /** 이름·GitHub handle 부분 일치 검색 — 팀장만 검색할 수 있다. */
  async searchCandidates(
    githubId: bigint,
    teamId: string,
    query: string,
  ): Promise<InvitationCandidateRecord[]> {
    const userId = await this.requireUserId(githubId);
    const team = await this.requireTeamLeader(teamId, userId);
    this.requireUnlockedTeam(team.locked);
    const trimmed = query.trim();
    if (!trimmed) return [];
    return this.repository.searchCandidates(team.programId, trimmed, userId);
  }

  async create(
    githubId: bigint,
    teamId: string,
    inviteeUserId: string,
  ): Promise<TeamInvitationRecord> {
    const actorId = await this.requireUserId(githubId);
    const team = await this.requireTeamLeader(teamId, actorId);
    this.requireUnlockedTeam(team.locked);

    if (inviteeUserId === actorId) {
      throw this.error(TeamInvitationErrorCode.SELF_INVITE_FORBIDDEN);
    }
    const inviteeEligibility =
      await this.repository.getInviteeEligibility(inviteeUserId);
    switch (inviteeEligibility) {
      case 'not-found':
        throw this.error(TeamInvitationErrorCode.INVITEE_NOT_FOUND);
      case 'not-eligible':
        throw this.error(TeamInvitationErrorCode.INVITEE_NOT_ELIGIBLE);
      case 'eligible':
        break;
    }
    const alreadyInTeam = await this.repository.isUserInProgramTeam(
      team.programId,
      inviteeUserId,
    );
    if (alreadyInTeam) {
      throw this.error(TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM);
    }
    const memberCount = await this.repository.countTeamMembers(teamId);
    if (memberCount >= team.teamMaxSize) {
      throw this.error(TeamInvitationErrorCode.TEAM_FULL);
    }

    try {
      return await this.repository.createInvitation({
        teamId,
        programId: team.programId,
        inviteeId: inviteeUserId,
        invitedById: actorId,
      });
    } catch (error) {
      if (error instanceof PendingInvitationConflictError) {
        throw this.error(TeamInvitationErrorCode.ALREADY_INVITED);
      }
      if (error instanceof TeamInvitationLockedError) {
        throw this.error(TeamInvitationErrorCode.TEAM_LOCKED_AFTER_APPLICATION);
      }
      throw error;
    }
  }

  /** 팀장이 자기 팀이 보낸 대기 중인 초대를 취소한다. */
  async cancel(githubId: bigint, invitationId: string): Promise<void> {
    const actorId = await this.requireUserId(githubId);
    const invitation =
      await this.repository.findInvitationForActor(invitationId);
    if (!invitation) {
      throw this.error(TeamInvitationErrorCode.INVITATION_NOT_FOUND);
    }
    if (invitation.leaderId !== actorId) {
      throw this.error(TeamInvitationErrorCode.NOT_TEAM_LEADER);
    }
    const closed =
      await this.repository.closePendingInvitationAsDeclined(invitationId);
    if (closed === 0) {
      throw this.error(TeamInvitationErrorCode.INVITATION_NOT_PENDING);
    }
  }

  /** 초대받은 본인이 거절한다. */
  async decline(githubId: bigint, invitationId: string): Promise<void> {
    const actorId = await this.requireUserId(githubId);
    const invitation =
      await this.repository.findInvitationForActor(invitationId);
    if (!invitation) {
      throw this.error(TeamInvitationErrorCode.INVITATION_NOT_FOUND);
    }
    if (invitation.inviteeId !== actorId) {
      throw this.error(TeamInvitationErrorCode.NOT_INVITEE);
    }
    const closed =
      await this.repository.closePendingInvitationAsDeclined(invitationId);
    if (closed === 0) {
      throw this.error(TeamInvitationErrorCode.INVITATION_NOT_PENDING);
    }
  }

  /**
   * 초대받은 본인이 수락한다. `@@unique([programId,userId])` 위반(이미 다른 팀
   * 소속)과 팀 정원 초과, 동시 수락 경합은 repository 트랜잭션이 원자적으로
   * 처리한다.
   */
  async accept(
    githubId: bigint,
    invitationId: string,
  ): Promise<AcceptedInvitationResult> {
    const actorId = await this.requireUserId(githubId);
    const outcome = await this.repository.withAcceptTransaction(
      invitationId,
      actorId,
      new Date(),
      async (store, names) => {
        await this.auditLog.record(
          {
            actorGithubId: githubId,
            action: TEAM_JOINED_AUDIT_ACTIONS.TEAM_JOINED,
            targetType: 'TEAM',
            targetId: names.teamId,
            metadata: createTeamJoinedAuditMetadata({
              programName: names.programName,
              teamName: names.teamName,
            }),
          },
          store.auditLogWriter,
        );
      },
    );
    switch (outcome.kind) {
      case 'not-found':
        throw this.error(TeamInvitationErrorCode.INVITATION_NOT_FOUND);
      case 'forbidden':
        throw this.error(TeamInvitationErrorCode.NOT_INVITEE);
      case 'not-pending':
        throw this.error(TeamInvitationErrorCode.INVITATION_NOT_PENDING);
      case 'already-in-team':
        throw this.error(TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM);
      case 'team-full':
        throw this.error(TeamInvitationErrorCode.TEAM_FULL);
      case 'invitee-not-eligible':
        throw this.error(TeamInvitationErrorCode.INVITEE_NOT_ELIGIBLE);
      case 'team-locked':
        throw this.error(TeamInvitationErrorCode.TEAM_LOCKED_AFTER_APPLICATION);
      case 'ok':
        return { teamId: outcome.teamId, programId: outcome.programId };
    }
  }

  private async requireUserId(githubId: bigint): Promise<string> {
    const userId = await this.repository.findUserIdByGithubId(githubId);
    if (!userId) {
      throw this.error(TeamInvitationErrorCode.UNAUTHENTICATED);
    }
    return userId;
  }

  private async requireTeamMember(teamId: string, userId: string) {
    const team = await this.repository.findTeamContext(teamId);
    if (!team) {
      throw this.error(TeamInvitationErrorCode.TEAM_NOT_FOUND);
    }
    const isMember = await this.repository.isTeamMember(teamId, userId);
    if (!isMember) {
      throw this.error(TeamInvitationErrorCode.NOT_TEAM_MEMBER);
    }
    return team;
  }

  private async requireTeamLeader(teamId: string, userId: string) {
    const team = await this.repository.findTeamContext(teamId);
    if (!team) {
      throw this.error(TeamInvitationErrorCode.TEAM_NOT_FOUND);
    }
    if (team.leaderId !== userId) {
      throw this.error(TeamInvitationErrorCode.NOT_TEAM_LEADER);
    }
    return team;
  }

  private error(code: TeamInvitationErrorCode): DomainException {
    return new DomainException(TEAM_INVITATION_ERROR_CODES[code]);
  }

  private requireUnlockedTeam(locked: boolean): void {
    if (locked) {
      throw this.error(TeamInvitationErrorCode.TEAM_LOCKED_AFTER_APPLICATION);
    }
  }
}
