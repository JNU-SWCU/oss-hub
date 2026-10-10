import { Injectable } from '@nestjs/common';
import {
  createTeamJoinedAuditMetadata,
  TEAM_JOINED_AUDIT_ACTIONS,
} from '../../audit-log/domain/audit-log-metadata';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { DomainException } from '../../common/error-code';
import {
  TEAM_INVITATION_ERROR_CODES,
  TeamInvitationErrorCode,
} from '../team-invitation-error-code.enum';
import { TeamInvitationsRepository } from '../repository/team-invitations.repository';
import type {
  AcceptedInvitationResult,
  InvitationCandidateRecord,
  ReceivedTeamInvitationRecord,
  SentTeamInvitationRecord,
} from '../domain/team-invitation';

@Injectable()
export class TeamInvitationsService {
  constructor(
    private readonly repository: TeamInvitationsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async listReceived(
    githubId: bigint,
  ): Promise<ReceivedTeamInvitationRecord[]> {
    const userId = await this.requireUserId(githubId);
    return this.repository.findByInviteeId(userId);
  }

  async listSentByTeam(
    githubId: bigint,
    teamId: string,
  ): Promise<SentTeamInvitationRecord[]> {
    const userId = await this.requireUserId(githubId);
    await this.requireTeamMember(teamId, userId);
    return this.repository.findByTeamId(teamId);
  }

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
    if (await this.repository.isActiveStaff(userId)) return team;
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
    if (await this.repository.isActiveStaff(userId)) return team;
    if (team.leaderId !== userId) {
      throw this.error(TeamInvitationErrorCode.NOT_TEAM_LEADER);
    }
    return team;
  }

  private error(code: TeamInvitationErrorCode): DomainException {
    return new DomainException(TEAM_INVITATION_ERROR_CODES[code]);
  }
}
