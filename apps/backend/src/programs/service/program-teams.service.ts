import { randomBytes } from 'node:crypto';
import type {
  RepositoryUrlHistoryCursor,
  RepositoryUrlHistoryPage,
  TeamActivityView,
} from '../program-team-repository-evidence.types';
import { canEditStudentRepositoryUrl } from '../program-participant';
import { Inject, Injectable } from '@nestjs/common';
import {
  createTeamCreatedAuditMetadata,
  createTeamDeletedAuditMetadata,
  createTeamMembershipAuditMetadata,
  createTeamRenamedAuditMetadata,
  TEAM_CREATED_AUDIT_ACTIONS,
  TEAM_DELETED_AUDIT_ACTIONS,
  TEAM_MEMBERSHIP_AUDIT_ACTIONS,
  TEAM_RENAMED_AUDIT_ACTIONS,
} from '../../audit-log/audit-log-metadata';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainException } from '../../common/error-code';
import {
  computeJoinCodeDigest,
  resolveJoinCodeSecretFromConfig,
} from '../../common/join-code-digest';
import type { RuntimeConfig } from '../../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../../runtime-config/runtime-config.module';
import {
  JoinCodeDigestConflictError,
  ProgramTeamsRepository,
  TeamMembershipConflictError,
  type CreatedTeamRecord,
  type StaffTeamDetailRecord,
  type StaffTeamRecord,
  type TeamDetailRecord,
  type TeamMembershipAuditEvent,
  type TeamMembershipAuditStore,
  type TeamProgramRecord,
  type TeamRenameAuditEvent,
} from '../repository/program-teams.repository';
import {
  ProgramTeamDeletionRepository,
  type TeamDeletionAuditEvent,
  type TeamDeletionAuditStore,
  type TeamDeletionNotificationEvent,
  type TeamDeletionNotificationStore,
} from '../repository/program-team-deletion.repository';
import type { TeamDeletionScopeCounts } from '../team-deletion-scope';
import { TEAMS_ERROR_CODES, TeamsErrorCode } from '../teams-error-code.enum';
import type {
  CreatedTeamView,
  DeletedTeamView,
  ProgramTeamView,
  RenamedTeamView,
  StaffTeamDetailView,
  StaffTeamView,
} from '../program-teams.types';

const TEAM_DELETED_NOTIFICATION_TYPE = 'TEAM_DELETED';

async function recordTeamDeletionNotification(
  store: TeamDeletionNotificationStore,
  event: TeamDeletionNotificationEvent,
  message: string | null,
): Promise<void> {
  if (event.recipientUserIds.length === 0) return;
  const deletedAt = event.deletedAt.toISOString();
  await store.notificationWriter.notification.createMany({
    data: event.recipientUserIds.map((userId) => ({
      userId,
      type: TEAM_DELETED_NOTIFICATION_TYPE,
      channel: 'IN_APP',
      status: 'UNREAD',
      idempotencyKey: `team-deleted:${event.teamId}:${userId}`,
      payload: {
        schemaVersion: 1,
        teamId: event.teamId,
        teamName: event.teamName,
        programId: event.programId,
        programName: event.programName,

        message: message?.trim() ? message.trim() : null,
        deletedAt,
      },
    })),

    skipDuplicates: true,
  });
}

const JOIN_CODE_ATTEMPTS = 5;

function generateJoinCode(): string {
  return randomBytes(6).toString('base64url').toUpperCase().slice(0, 10);
}

@Injectable()
export class ProgramTeamsService {
  private readonly joinCodeSecret: string;

  constructor(
    private readonly repository: ProgramTeamsRepository,
    @Inject(RUNTIME_CONFIG) runtimeConfig: RuntimeConfig,
    private readonly auditLog: AuditLogService,
    private readonly deletionRepository: ProgramTeamDeletionRepository,
  ) {
    this.joinCodeSecret = resolveJoinCodeSecretFromConfig(runtimeConfig);
  }

  async create(
    githubId: bigint,
    programId: string,
    name: string,
    now: Date = new Date(),
  ): Promise<CreatedTeamView> {
    const student = await this.requireStudent(githubId);
    const program = await this.requireOpenProgram(programId, now);
    const trimmedName = name.trim();

    let joinCode = '';
    let created: CreatedTeamRecord | null = null;

    for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt += 1) {
      joinCode = generateJoinCode();
      const joinCodeDigest = computeJoinCodeDigest(
        joinCode,
        this.joinCodeSecret,
      );
      try {
        created = await this.repository.withCreateTransaction(async (store) => {
          const existing = await store.findMembershipByProgramUser(
            programId,
            student.id,
          );
          if (existing) {
            throw this.error(TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM);
          }
          const team = await store.createTeamWithLeader({
            programId,
            name: trimmedName,
            joinCodeDigest,
            leaderId: student.id,
          });
          await this.auditLog.record(
            {
              actorGithubId: githubId,
              action: TEAM_CREATED_AUDIT_ACTIONS.TEAM_CREATED,
              targetType: 'TEAM',
              targetId: team.id,
              metadata: createTeamCreatedAuditMetadata({
                programName: program.name,
                teamName: team.name,
              }),
            },
            store.auditLogWriter,
          );
          return team;
        });
        break;
      } catch (error) {
        if (error instanceof DomainException) throw error;
        if (error instanceof TeamMembershipConflictError) {
          throw this.error(TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM);
        }
        if (error instanceof JoinCodeDigestConflictError) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw new Error('join code digest collision retries exhausted');
    }

    return {
      id: created.id,
      name: created.name,
      joinCode,
      memberCount: 1,
    };
  }

  async getMe(
    githubId: bigint,
    programId: string,
  ): Promise<ProgramTeamView | null> {
    const student = await this.requireStudent(githubId);
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(TeamsErrorCode.PROGRAM_NOT_FOUND);
    }

    const detail = await this.repository.findTeamDetailForUser(
      programId,
      student.id,
    );
    if (!detail) return null;
    return this.toTeamView(detail, student.id);
  }

  async leave(githubId: bigint, programId: string): Promise<void> {
    const student = await this.requireStudent(githubId);
    const result = await this.repository.leave(
      programId,
      student.id,
      (store, event) => this.recordMembershipAudit(githubId, store, event),
    );
    if (result === 'not-found') {
      throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
    }
    if (result === 'last-member-with-application') {
      throw this.error(TeamsErrorCode.LAST_MEMBER_WITH_APPLICATION);
    }
  }

  async removeMember(
    githubId: bigint,
    programId: string,
    targetUserId: string,
  ): Promise<void> {
    const student = await this.requireStudent(githubId);
    const result = await this.repository.removeMember(
      programId,
      student.id,
      targetUserId,
      (store, event) => this.recordMembershipAudit(githubId, store, event),
    );
    switch (result) {
      case 'removed':
        return;
      case 'actor-not-in-team':
        throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
      case 'not-leader':
        throw this.error(TeamsErrorCode.TEAM_LEADER_REQUIRED);
      case 'self-target':
        throw this.error(TeamsErrorCode.SELF_REMOVAL_REQUIRES_LEAVE);
      case 'target-not-found':
        throw this.error(TeamsErrorCode.TARGET_MEMBER_NOT_FOUND);
    }
  }

  async removeMemberForStaff(
    githubId: bigint,
    programId: string,
    teamId: string,
    targetUserId: string,
  ): Promise<void> {
    const actor = await this.repository.findActorAuthorityByGithubId(githubId);
    if (!actor?.isStaff) {
      throw this.error(TeamsErrorCode.STAFF_ONLY);
    }

    const result = await this.repository.removeMemberForStaff(
      programId,
      teamId,
      actor.id,
      targetUserId,
      (store, event) => this.recordMembershipAudit(githubId, store, event),
    );
    switch (result) {
      case 'removed':
        return;
      case 'forbidden':
        throw this.error(TeamsErrorCode.STAFF_ONLY);
      case 'not-found':
        throw this.error(TeamsErrorCode.TARGET_MEMBER_NOT_FOUND);
      case 'last-member-with-application':
        throw this.error(TeamsErrorCode.LAST_MEMBER_WITH_APPLICATION);
    }
  }

  async transferLeaderForStaff(
    githubId: bigint,
    programId: string,
    teamId: string,
    targetUserId: string,
  ): Promise<void> {
    const actor = await this.repository.findActorAuthorityByGithubId(githubId);
    if (!actor?.isStaff) {
      throw this.error(TeamsErrorCode.STAFF_ONLY);
    }

    const result = await this.repository.transferLeaderForStaff(
      programId,
      teamId,
      actor.id,
      targetUserId,
      (store, event) => this.recordMembershipAudit(githubId, store, event),
    );
    switch (result) {
      case 'transferred':
      case 'unchanged':
        return;
      case 'forbidden':
        throw this.error(TeamsErrorCode.STAFF_ONLY);
      case 'not-found':
        throw this.error(TeamsErrorCode.TARGET_MEMBER_NOT_FOUND);
    }
  }

  async rename(
    githubId: bigint,
    programId: string,
    teamId: string,
    name: string,
  ): Promise<RenamedTeamView> {
    const actor = await this.repository.findActorAuthorityByGithubId(githubId);
    if (!actor) {
      throw this.error(TeamsErrorCode.TEAM_RENAME_FORBIDDEN);
    }

    const trimmedName = name.trim();
    const result = await this.repository.renameTeam(
      programId,
      teamId,
      actor,
      trimmedName,
      (store, event) => this.recordRenameAudit(githubId, store, event),
    );
    switch (result) {
      case 'renamed':
        return { teamId, name: trimmedName };
      case 'not-found':
        throw this.error(TeamsErrorCode.TARGET_TEAM_NOT_FOUND);
      case 'forbidden':
        throw this.error(TeamsErrorCode.TEAM_RENAME_FORBIDDEN);
    }
  }

  private async recordRenameAudit(
    actorGithubId: bigint,
    store: TeamMembershipAuditStore,
    event: TeamRenameAuditEvent,
  ): Promise<void> {
    await this.auditLog.record(
      {
        actorGithubId,
        action: TEAM_RENAMED_AUDIT_ACTIONS.TEAM_RENAMED,
        targetType: 'TEAM',
        targetId: event.teamId,
        metadata: createTeamRenamedAuditMetadata({
          programName: event.programName,
          teamName: event.nextName,
          previousName: event.previousName,
        }),
      },
      store.auditLogWriter,
    );
  }

  private async recordMembershipAudit(
    actorGithubId: bigint,
    store: TeamMembershipAuditStore,
    event: TeamMembershipAuditEvent,
  ): Promise<void> {
    await this.auditLog.record(
      {
        actorGithubId,
        action: TEAM_MEMBERSHIP_AUDIT_ACTIONS.TEAM_MEMBERSHIP_CHANGED,
        targetType: 'TEAM',
        targetId: event.teamId,
        metadata: createTeamMembershipAuditMetadata({
          programName: event.programName,
          teamName: event.teamName,
          operation: event.operation,
          removedUserId: event.removedUserId,
          previousLeaderId: event.previousLeaderId,
          nextLeaderId: event.nextLeaderId,
        }),
      },
      store.auditLogWriter,
    );
  }

  async listForStaff(programId: string): Promise<StaffTeamView[]> {
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(TeamsErrorCode.PROGRAM_NOT_FOUND);
    }
    const teams = await this.repository.listStaffTeams(programId);
    return teams.map((team) => this.toStaffTeamView(team));
  }

  async getForStaff(
    programId: string,
    teamId: string,
  ): Promise<StaffTeamDetailView> {
    const detail = await this.repository.findStaffTeamDetail(programId, teamId);
    if (!detail) {
      throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
    }
    return this.toStaffTeamDetailView(
      detail,
      await this.deletionRepository.readScopeCounts(teamId),
    );
  }

  async deleteForStaff(
    githubId: bigint,
    programId: string,
    teamId: string,
    expectedScope: TeamDeletionScopeCounts,
    notificationMessage: string | null = null,
  ): Promise<DeletedTeamView> {
    const actor = await this.repository.findActorAuthorityByGithubId(githubId);
    if (!actor?.isStaff) {
      throw this.error(TeamsErrorCode.TEAM_DELETE_FORBIDDEN);
    }

    const result = await this.deletionRepository.deleteTeam(
      programId,
      teamId,
      expectedScope,
      (store, event) => this.recordDeletionAudit(githubId, store, event),
      (store, event) =>
        recordTeamDeletionNotification(store, event, notificationMessage),
    );
    switch (result.outcome) {
      case 'deleted':
        return {
          teamId,
          deleted: true,
          deletedCounts: result.deletedCounts,
        };
      case 'not-found':
        throw this.error(TeamsErrorCode.TARGET_TEAM_NOT_FOUND);
      case 'scope-changed':
        throw new DomainException(
          TEAMS_ERROR_CODES[TeamsErrorCode.TEAM_DELETE_SCOPE_CHANGED],
          { currentTeamScopeCounts: result.currentScopeCounts },
        );
    }
  }

  private async recordDeletionAudit(
    actorGithubId: bigint,
    store: TeamDeletionAuditStore,
    event: TeamDeletionAuditEvent,
  ): Promise<void> {
    await this.auditLog.record(
      {
        actorGithubId,
        action: TEAM_DELETED_AUDIT_ACTIONS.TEAM_DELETED,
        targetType: 'TEAM',
        targetId: event.teamId,
        metadata: createTeamDeletedAuditMetadata({
          programName: event.programName,
          teamName: event.teamName,
          deletedCounts: event.deletedCounts,
        }),
      },
      store.auditLogWriter,
    );
  }

  private toStaffTeamDetailView(
    detail: StaffTeamDetailRecord,
    deletionScope: TeamDeletionScopeCounts,
  ): StaffTeamDetailView {
    const members = detail.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      nickname: member.nickname,
      isLeader: member.userId === detail.leaderId,
    }));
    return {
      teamId: detail.id,
      name: detail.name,
      memberCount: members.length,
      members: [
        ...members.filter((member) => member.isLeader),
        ...members.filter((member) => !member.isLeader),
      ],
      application: detail.application,
      repositoryContributions: detail.repositoryContributions,
      repositoryUrlHistory: detail.repositoryUrlHistory,
      deletionScope,
    };
  }

  async getActivity(
    githubId: bigint,
    programId: string,
    teamId: string,
    now: Date = new Date(),
  ): Promise<TeamActivityView> {
    const { actor, team } = await this.requireTeamReader(
      githubId,
      programId,
      teamId,
    );
    return {
      ...(await this.repository.readTeamActivity(team)),

      canEditRepositoryUrl:
        team.application !== null &&
        canEditStudentRepositoryUrl(
          {
            status: team.application.status,
            endAt: team.program.endAt,
            isManager: actor.isStaff || team.leaderId === actor.id,
          },
          now,
        ),
    };
  }

  async getRepositoryUrlHistory(
    githubId: bigint,
    programId: string,
    teamId: string,
    cursor?: RepositoryUrlHistoryCursor,
  ): Promise<RepositoryUrlHistoryPage> {
    await this.requireTeamReader(githubId, programId, teamId);
    const history = await this.repository.findStaffRepositoryUrlHistory(
      programId,
      teamId,
      cursor,
    );
    if (!history) throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
    return history;
  }

  private async requireTeamReader(
    githubId: bigint,
    programId: string,
    teamId: string,
  ) {
    const actor = await this.repository.findActorAuthorityByGithubId(githubId);
    const team = actor
      ? await this.repository.findTeamActivityScope(programId, teamId)
      : null;
    if (
      !actor ||
      !team ||
      (!actor.isStaff &&
        !team.members.some((member) => member.userId === actor.id))
    ) {
      throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
    }
    return { actor, team };
  }

  private toStaffTeamView(team: StaffTeamRecord): StaffTeamView {
    const members = team.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      nickname: member.nickname,
      isLeader: member.userId === team.leaderId,
    }));
    return {
      teamId: team.id,
      name: team.name,
      memberCount: members.length,

      members: [
        ...members.filter((member) => member.isLeader),
        ...members.filter((member) => !member.isLeader),
      ],
    };
  }

  private async requireStudent(githubId: bigint) {
    const student = await this.repository.findActiveStudentByGithubId(githubId);
    if (!student) {
      throw this.error(TeamsErrorCode.STUDENT_ONLY);
    }
    return student;
  }

  private async requireOpenProgram(
    programId: string,
    now: Date,
  ): Promise<TeamProgramRecord> {
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(TeamsErrorCode.PROGRAM_NOT_FOUND);
    }
    if (now < program.applicationStartAt || now > program.applicationEndAt) {
      throw this.error(TeamsErrorCode.APPLICATION_PERIOD_CLOSED);
    }
    return program;
  }

  private toTeamView(
    detail: TeamDetailRecord,
    viewerUserId: string,
  ): ProgramTeamView {
    const memberCount = detail.members.length;
    const isLeader = detail.leaderId === viewerUserId;
    return {
      id: detail.id,
      name: detail.name,
      memberCount,
      minMembers: detail.teamMinSize,
      maxMembers: detail.teamMaxSize,
      hasApplication: detail.hasApplication,
      isLeader,
      canInvite: isLeader,
      canRemoveMembers: isLeader && memberCount > 1,
      canLeave: memberCount > 1 || !detail.hasApplication,
      members: detail.members.map((member) => ({
        userId: member.userId,
        nickname: member.nickname,
        name: member.name,
        isLeader: member.userId === detail.leaderId,
      })),
    };
  }

  private error(code: TeamsErrorCode): DomainException {
    return new DomainException(TEAMS_ERROR_CODES[code]);
  }
}
