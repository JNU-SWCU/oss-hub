import { BadRequestException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import {
  type TeamActivityView,
  type RepositoryUrlHistoryCursor,
  type TeamApplicationView,
  type TeamRepositoryProvisioningJobStatus,
  type TeamRepositoryProvisioningSafeErrorClass,
  type RepositoryUrlHistoryRows,
  type RepositoryUrlHistoryPage,
  type DeletedTeamView,
  type ProgramTeamView,
  type RenamedTeamView,
  type StaffTeamDetailView,
  type StaffTeamView,
  type RepositoryUrlHistoryRow,
  type RepositoryUrlHistoryView,
  type TeamRepositoryContributionsRow,
  type TeamRepositoryContributionsView,
} from './program-team-repository-evidence.repository';
import {
  ApplicationStatus,
  OutboxEventStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import { AuditLogService } from '../platform/audit-log.service';
import {
  TEAM_DELETED_AUDIT_ACTIONS,
  TEAM_MEMBERSHIP_AUDIT_ACTIONS,
  TEAM_RENAMED_AUDIT_ACTIONS,
} from '../platform/audit-log-metadata.config';
import { DomainException } from '../platform/error-code.error';
import {
  ProgramTeamsRepository,
  type StaffTeamDetailRecord,
  type StaffTeamRecord,
  type TeamDetailRecord,
  type TeamMembershipAuditEvent,
  type TeamMembershipAuditStore,
  type TeamRenameAuditEvent,
  type TeamApplicationRow,
} from './program-teams.repository';
import {
  ProgramTeamDeletionRepository,
  type TeamDeletionAuditEvent,
  type TeamDeletionAuditStore,
  type TeamDeletionNotificationEvent,
  type TeamDeletionNotificationStore,
} from './program-team-deletion.repository';
import { TEAMS_ERROR_CODES, TeamsErrorCode } from './teams-error-code.error';
import type { TeamDeletionScopeCounts } from './team-deletion-scope.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { REPOSITORY_CONNECTION_AUDIT_ACTIONS } from '../platform/repository-audit-metadata.config';
import { InvalidRepositoryUrlHistoryError } from './program-team-repository-evidence.error';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { MilestoneCompletionService } from './milestone-completion.service';
import { ProgramRulesService } from './program-rules.service';

const TEAM_DELETED_NOTIFICATION_TYPE = 'TEAM_DELETED';

async function recordTeamDeletionNotification(
  store: TeamDeletionNotificationStore,
  event: TeamDeletionNotificationEvent,
  message: string | null,
): Promise<void> {
  if (event.recipientUserIds.length === 0) return;
  const deletedAt = event.deletedAt.toISOString();
  await store.createTeamDeletedNotifications(
    event.recipientUserIds.map((userId) => ({
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
  );
}

interface RepositoryUrlHistoryScope {
  readonly programId: string;
  readonly teamId: string;
  readonly applicationId: string | null;
}

@Injectable()
export class ProgramTeamsService {
  constructor(
    private readonly repository: ProgramTeamsRepository,
    private readonly auditLog: AuditLogService,
    private readonly deletionRepository: ProgramTeamDeletionRepository,
    private readonly auditLogMetadataService: AuditLogMetadataService,
    private readonly repositoryPublishService: RepositoryPublishService,
    private readonly repositoryUrlService: RepositoryUrlService,
    private readonly milestoneCompletionService: MilestoneCompletionService,
    private readonly programRulesService: ProgramRulesService,
  ) {}

  repositoryUrlHistoryCursorFromRequest(request: {
    readonly cursor?: string;
  }): RepositoryUrlHistoryCursor | undefined {
    if (request.cursor === undefined) return undefined;
    const match =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([a-zA-Z0-9:-]+)$/.exec(
        request.cursor,
      );
    const timestamp = match?.[1];
    const id = match?.[2];
    if (!timestamp || !id)
      throw new BadRequestException('Invalid history cursor');
    const occurredAt = new Date(timestamp);
    if (
      !Number.isFinite(occurredAt.getTime()) ||
      occurredAt.toISOString() !== timestamp
    )
      throw new BadRequestException('Invalid history cursor');
    return { occurredAt, id };
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
        metadata: this.auditLogMetadataService.createTeamRenamedAuditMetadata({
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
        metadata:
          this.auditLogMetadataService.createTeamMembershipAuditMetadata({
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
      programId,
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
        metadata: this.auditLogMetadataService.createTeamDeletedAuditMetadata({
          programName: event.programName,
          teamName: event.teamName,
          deletedCounts: event.deletedCounts,
        }),
      },
      store.auditLogWriter,
    );
  }

  private toContributionsView(
    row: TeamRepositoryContributionsRow,
  ): TeamRepositoryContributionsView {
    const { nameWithOwner, ...contributions } = row;
    return {
      ...contributions,
      repositoryUrl:
        this.repositoryUrlService.repositoryUrlFromNameWithOwner(nameWithOwner),
    };
  }

  private toTeamApplicationView(row: TeamApplicationRow): TeamApplicationView {
    const { repository, job } = row;
    const completionTargets =
      this.milestoneCompletionService.projectSubmissionCompletionTargets(
        row.milestoneDocumentSubmissions,
      );
    const blockedReasons = repository
      ? this.repositoryPublishService.publishBlockedReasons(
          {
            visibility: repository.visibility,
            provisionStatus:
              job?.repositoryId === repository.id ? job.status : null,
            requiredMilestonesApproved:
              this.milestoneCompletionService.requiredMilestonesApproved(
                row.program.milestones,
                completionTargets.submissions,
                completionTargets.documentSubmissions,
              ),
            isRepositoryPublicationPlanned: row.isRepositoryPublicationPlanned,
            programEndAt: row.program.endAt,
          },
          new Date(),
        )
      : [];
    const repositoryUrl =
      repository &&
      this.repositoryUrlService.repositoryUrlFromNameWithOwner(
        repository.nameWithOwner,
      );
    return {
      id: row.id,
      status: row.status,
      repositoryConnectionMode: row.repositoryConnectionMode,
      repository:
        repository && repositoryUrl
          ? {
              id: repository.id,
              url: repositoryUrl,
              visibility: repository.visibility,
              publishEligible: blockedReasons.length === 0,
              blockedReasons,
            }
          : null,
      repositoryProvisioning:
        repository &&
        row.repositoryUrl === repositoryUrl &&
        job?.repositoryId === repository.id &&
        job.status === RepositoryProvisionJobStatus.SUCCEEDED
          ? {
              enabled: row.program.repositoryProvisioningEnabled,
              jobStatus: 'SUCCEEDED',
              updatedAt: job.updatedAt,
              safeErrorClass: null,
            }
          : resolveTeamRepositoryProvisioning(
              row.status,
              row.program.repositoryProvisioningEnabled,
              row.updatedAt,
              row.outbox ?? undefined,
              job ?? undefined,
            ),
    };
  }

  private toStaffTeamDetailView(
    programId: string,
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
      application:
        detail.application && this.toTeamApplicationView(detail.application),
      repositoryContributions:
        detail.repositoryContributions &&
        this.toContributionsView(detail.repositoryContributions),
      repositoryUrlHistory: this.toRepositoryUrlHistoryPage(
        detail.repositoryUrlHistory,
        {
          programId,
          teamId: detail.id,
          applicationId: detail.application?.id ?? null,
        },
      ),
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
    const activity = await this.repository.readTeamActivity(team);
    return {
      ...activity,
      repository: activity.repository && {
        id: activity.repository.id,
        url: this.repositoryUrlService.repositoryUrlFromNameWithOwner(
          activity.repository.nameWithOwner,
        ),
      },

      canEditRepositoryUrl:
        team.application !== null &&
        this.programRulesService.canEditStudentRepositoryUrl(
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
    return this.toRepositoryUrlHistoryPage(history, {
      programId,
      teamId,
      applicationId: history.applicationId,
    });
  }

  private toRepositoryUrlHistoryPage(
    history: RepositoryUrlHistoryRows,
    scope: RepositoryUrlHistoryScope,
  ): RepositoryUrlHistoryPage {
    const items = history.rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      ...this.repositoryUrlChange(row, scope),
    }));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        history.hasMore && last ? `${last.occurredAt}_${last.id}` : null,
    };
  }

  private repositoryUrlChange(
    row: RepositoryUrlHistoryRow,
    scope: RepositoryUrlHistoryScope,
  ): Omit<RepositoryUrlHistoryView, 'id' | 'occurredAt'> {
    if (
      row.action !==
      REPOSITORY_CONNECTION_AUDIT_ACTIONS.REPOSITORY_CONNECTION_CHANGED
    ) {
      const metadata =
        this.auditLogMetadataService.parseApplicationRepositoryUrlAuditMetadata(
          row.metadata,
        );
      if (
        metadata?.programId === scope.programId &&
        metadata.teamId === scope.teamId
      )
        return {
          actorGithubLogin: metadata.actorGithubLogin,
          previousRepositoryUrl: metadata.before.repositoryUrl,
          newRepositoryUrl: metadata.after.repositoryUrl,
        };
      throw new InvalidRepositoryUrlHistoryError();
    }

    const metadata =
      this.auditLogMetadataService.parseRepositoryConnectionAuditMetadata(
        row.metadata,
      );
    if (
      metadata?.applicationId !== scope.applicationId ||
      !metadata.after.nameWithOwner
    )
      throw new InvalidRepositoryUrlHistoryError();
    return {
      actorGithubLogin: row.actor.nickname,
      previousRepositoryUrl: metadata.before.nameWithOwner
        ? this.repositoryUrlService.repositoryUrlFromNameWithOwner(
            metadata.before.nameWithOwner,
          )
        : null,
      newRepositoryUrl:
        this.repositoryUrlService.repositoryUrlFromNameWithOwner(
          metadata.after.nameWithOwner,
        ),
    };
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

interface TeamProvisionOutbox {
  readonly status: OutboxEventStatus;
  readonly createdAt: Date;
}

interface TeamProvisionJob {
  readonly status: RepositoryProvisionJobStatus;
  readonly updatedAt: Date;
  readonly lastErrorCode: string | null;
}

function resolveTeamRepositoryProvisioning(
  applicationStatus: ApplicationStatus,
  enabled: boolean,
  applicationUpdatedAt: Date,
  outbox: TeamProvisionOutbox | undefined,
  job: TeamProvisionJob | undefined,
): TeamApplicationView['repositoryProvisioning'] {
  const anomalous = (): TeamApplicationView['repositoryProvisioning'] => ({
    enabled,
    jobStatus: 'ANOMALOUS',
    updatedAt: applicationUpdatedAt,
    safeErrorClass: 'UNKNOWN',
  });
  if (applicationStatus !== ApplicationStatus.APPROVED) {
    if (outbox || job) {
      return anomalous();
    }
    return {
      enabled,
      jobStatus: enabled ? 'NOT_REQUESTED' : 'DISABLED',
      updatedAt: applicationUpdatedAt,
      safeErrorClass: null,
    };
  }

  if (
    (job && !outbox) ||
    (job && outbox?.status !== OutboxEventStatus.PROCESSED) ||
    (!job && outbox?.status === OutboxEventStatus.PROCESSED)
  ) {
    return anomalous();
  }

  if (job && outbox?.status === OutboxEventStatus.PROCESSED) {
    const jobStatus = mapTeamProvisionJobStatus(job.status);
    return {
      enabled,
      jobStatus,
      updatedAt: job.updatedAt,
      safeErrorClass:
        jobStatus === 'RETRYABLE_FAILED' || jobStatus === 'FAILED'
          ? normalizeTeamSafeErrorClass(job.lastErrorCode)
          : null,
    };
  }

  if (enabled && outbox) {
    if (
      outbox.status === OutboxEventStatus.PENDING ||
      outbox.status === OutboxEventStatus.PROCESSING
    ) {
      return {
        enabled,
        jobStatus: 'PENDING',
        updatedAt: outbox.createdAt,
        safeErrorClass: null,
      };
    }
    if (outbox.status === OutboxEventStatus.FAILED) {
      return {
        enabled,
        jobStatus: 'FAILED',
        updatedAt: outbox.createdAt,
        safeErrorClass: 'UNKNOWN',
      };
    }
  }

  if (!outbox && !job) {
    return {
      enabled,
      jobStatus: enabled ? 'ANOMALOUS' : 'DISABLED',
      updatedAt: applicationUpdatedAt,
      safeErrorClass: enabled ? 'UNKNOWN' : null,
    };
  }
  return anomalous();
}

function mapTeamProvisionJobStatus(
  status: RepositoryProvisionJobStatus,
): TeamRepositoryProvisioningJobStatus {
  switch (status) {
    case RepositoryProvisionJobStatus.PENDING:
      return 'PENDING';
    case RepositoryProvisionJobStatus.PROCESSING:
      return 'PROCESSING';
    case RepositoryProvisionJobStatus.SUCCEEDED:
      return 'SUCCEEDED';
    case RepositoryProvisionJobStatus.FAILED_RETRYABLE:
      return 'RETRYABLE_FAILED';
    case RepositoryProvisionJobStatus.FAILED_FINAL:
      return 'FAILED';
  }
}

function normalizeTeamSafeErrorClass(
  errorCode: string | null,
): TeamRepositoryProvisioningSafeErrorClass {
  switch (errorCode) {
    case 'GITHUB_OPERATIONS_CONFIGURATION':
    case 'GITHUB_OPERATIONS_INSTALLATION_NOT_FOUND':
    case 'GITHUB_OPERATIONS_ORGANIZATION_MISMATCH':
    case 'GITHUB_OPERATIONS_AUTHENTICATION':
    case 'GITHUB_OPERATIONS_PERMISSION':
      return 'AUTH';
    case 'GITHUB_OPERATIONS_RATE_LIMITED':
    case 'GITHUB_OPERATIONS_INVITATION_LIMIT':
      return 'RATE_LIMIT';
    case 'GITHUB_OPERATIONS_INVALID_INPUT':
    case 'REPOSITORY_PROVISION_APPLICATION_NOT_APPROVED':
    case 'REPOSITORY_PROVISION_FEATURE_DISABLED':
    case 'REPOSITORY_PROVISION_INVALID_EVENT':
    case 'REPOSITORY_PROVISION_REPOSITORY_MISMATCH':
      return 'UPSTREAM_REJECTED';
    case 'GITHUB_OPERATIONS_UPSTREAM':
    case 'GITHUB_OPERATIONS_INVALID_RESPONSE':
    case 'REPOSITORY_PROVISION_INTERNAL':
    case null:
    default:
      return 'UNKNOWN';
  }
}
