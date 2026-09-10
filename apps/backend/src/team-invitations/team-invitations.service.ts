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
  ReceivedTeamInvitationRecord,
  SentTeamInvitationRecord,
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
 *
 * 신청 제출 여부로 초대·검색·수락을 막지 않는다. 신청 창구는 초기 접수의 문일
 * 뿐이고, 참여가 시작된 뒤의 팀 구성 관리(초대·탈퇴·제외)는 팀장 권한과 정원으로
 * 통제한다. 권한 판정의 정본은 팀 행을 잠근 트랜잭션 안의 재조회다.
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
  ): Promise<SentTeamInvitationRecord[]> {
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
    const trimmed = query.trim();
    if (!trimmed) return [];
    return this.repository.searchCandidates(team.programId, trimmed, userId);
  }

  async create(
    githubId: bigint,
    teamId: string,
    inviteeUserId: string,
  ): Promise<SentTeamInvitationRecord> {
    const actorId = await this.requireUserId(githubId);
    // 사전 권한 확인 — 팀장이 아닌 사람에게 초대 대상의 존재·자격을 알리지 않는다.
    // 최종 판정은 아래 트랜잭션(팀 행 잠금 후 재조회)이 한다.
    await this.requireTeamLeader(teamId, actorId);

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
    const outcome = await this.repository.createInvitation({
      teamId,
      actorId,
      inviteeId: inviteeUserId,
    });
    switch (outcome.kind) {
      case 'team-not-found':
        throw this.error(TeamInvitationErrorCode.TEAM_NOT_FOUND);
      case 'not-team-leader':
        throw this.error(TeamInvitationErrorCode.NOT_TEAM_LEADER);
      case 'not-team-member':
        throw this.error(TeamInvitationErrorCode.NOT_TEAM_MEMBER);
      case 'invitee-already-in-team':
        throw this.error(TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM);
      case 'team-full':
        throw this.error(TeamInvitationErrorCode.TEAM_FULL);
      case 'already-invited':
        throw this.error(TeamInvitationErrorCode.ALREADY_INVITED);
      case 'ok':
        return outcome.invitation;
    }
  }

  /**
   * 대기 중인 초대 취소 — 팀 행을 잠근 시점의 현재 팀장만 할 수 있다.
   * 초대를 보낸 사람이 이미 탈퇴했어도 승계받은 팀장이 정리할 수 있고,
   * 떠난 전 팀장은 자기가 보낸 초대라도 더는 취소할 수 없다.
   */
  async cancel(githubId: bigint, invitationId: string): Promise<void> {
    const actorId = await this.requireUserId(githubId);
    const outcome = await this.repository.cancelPendingInvitationAsLeader(
      invitationId,
      actorId,
    );
    switch (outcome.kind) {
      case 'not-found':
        throw this.error(TeamInvitationErrorCode.INVITATION_NOT_FOUND);
      case 'not-team-leader':
        throw this.error(TeamInvitationErrorCode.NOT_TEAM_LEADER);
      case 'not-pending':
        throw this.error(TeamInvitationErrorCode.INVITATION_NOT_PENDING);
      case 'ok':
        return;
    }
  }

  /**
   * 초대받은 본인이 거절한다. 본인 초대가 아니면 존재 여부를 알리지 않고
   * TIV_010으로 답한다(초대 id로 남의 초대를 탐색할 수 없게 한다).
   */
  async decline(githubId: bigint, invitationId: string): Promise<void> {
    const actorId = await this.requireUserId(githubId);
    const outcome = await this.repository.declinePendingInvitationAsInvitee(
      invitationId,
      actorId,
    );
    switch (outcome.kind) {
      case 'not-found':
        throw this.error(TeamInvitationErrorCode.INVITATION_NOT_FOUND);
      case 'not-pending':
        throw this.error(TeamInvitationErrorCode.INVITATION_NOT_PENDING);
      case 'ok':
        return;
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
}
