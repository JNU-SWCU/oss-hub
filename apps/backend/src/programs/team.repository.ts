import { Injectable, Inject } from '@nestjs/common';
import {
  Prisma,
  type Prisma as PrismaTypes,
  AccountStatus,
  ApplicationStatus,
  OutboxEventStatus,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  RepositorySource,
  type RepositoryVisibility,
  ProgramLifecycle,
  type ProgramCategory,
  type OutboxEvent as PrismaOutboxEvent,
  ApplicationReviewEventKind,
  type ProgramTrackType,
  SubmissionFileLifecycle,
  CollectionRepositoryPresence,
} from '@prisma/client';
import { type TeamDeletionScopeCounts } from './team-deletion-scope.config';
import { type AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import { PrismaService } from '../platform/prisma.service';
import {
  RepositoryProvisionGenerationRepository,
  type RepositoryProvisionHistoryPayloadParser,
} from '../platform/repository-provision-generation.repository';
import {
  STUDENT_MEMBER_WHERE,
  USER_PROFILE_NAME_SELECT,
  USER_AUTHORITY_SELECT,
} from '../platform/user-profile-read.config';
import {
  type AppendReviewHistoryInput,
  type AppendedReviewHistory,
  ReviewHistoryWriterRepository,
  TeamHistoryRepository,
} from './team-history.repository';
import {
  RepositoryEventAlreadyExistsError,
  ApplicationDuplicateError,
  ApplicationTeamMembershipConflictError,
} from './applications.error';
import {
  APPLICATION_DECISION_ACTIONS,
  APPLICATION_LIST_STATUSES,
  APPLICATION_LIST_VIEWS,
} from './applications.config';
import { PlatformRepository } from '../platform/platform.repository';
import {
  STUDENT_APPLICATION_MANAGEMENT_CLOCK,
  RESUBMITTABLE_STATUSES,
  CANCELLABLE_STATUSES,
} from './student-application-management.config';
import {
  ProgramTeamRepositoryEvidenceRepository,
  type TeamActivityScope,
  type RepositoryUrlHistoryCursor,
  type TeamApplicationView,
  type RepositoryUrlHistoryRows,
  type TeamRepositoryContributionsRow,
  type TeamActivityRow,
} from './program-team-repository-evidence.repository';
import {
  type SubmissionCompletionTargetRow,
} from './submission-completion.config';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { TeamDeletedScopeMismatchError } from './program-team-deletion.error';
import { type OwnGithubRepositoryResolution } from '../github/own-repository-resolution.types';
import { RepositoryDeletionRepository } from '../platform/repository-deletion.repository';
import { type RepositoryDeletionCounts } from '../platform/repository-audit-metadata.config';

type DeletionScopeCountsRow = Readonly<{
  applications: bigint;
  members: bigint;
  invitations: bigint;
  submissions: bigint;
  submissionEvents: bigint;
  detachedRepositories: bigint;
  scopeFingerprint: string;
}>;

@Injectable()
export class TeamDeletionScopeRepository {
  sameCounts(
    left: TeamDeletionScopeCounts,
    right: TeamDeletionScopeCounts,
  ): boolean {
    return (
      this.sameCountValues(left, right) &&
      left.scopeFingerprint === right.scopeFingerprint
    );
  }

  sameCountValues(
    left: TeamDeletionScopeCounts,
    right: Omit<TeamDeletionScopeCounts, 'scopeFingerprint'>,
  ): boolean {
    return (
      left.applications === right.applications &&
      left.members === right.members &&
      left.invitations === right.invitations &&
      left.submissions === right.submissions &&
      left.submissionEvents === right.submissionEvents &&
      left.detachedRepositories === right.detachedRepositories
    );
  }

  async readTeamDeletionScopeCounts(
    transaction: PrismaTypes.TransactionClient,
    teamId: string,
  ): Promise<TeamDeletionScopeCounts> {
    const [row] = await transaction.$queryRaw<
      readonly DeletionScopeCountsRow[]
    >(
      Prisma.sql`
      WITH team_application AS (
        SELECT id FROM "Application" WHERE "teamId" = ${teamId}
      ),
      team_submission AS (
        SELECT document_submission.id
        FROM "MilestoneDocumentSubmission" AS document_submission
        WHERE document_submission."applicationId" IN (SELECT id FROM team_application)
      ),
      team_submission_history AS (
        SELECT history.id
        FROM "MilestoneDocumentSubmissionHistory" AS history
        WHERE history."milestoneDocumentSubmissionId" IN (SELECT id FROM team_submission)
      ),
      team_submission_file AS (
        SELECT file.id
        FROM "SubmissionFile" AS file
        WHERE file."applicationId" IN (SELECT id FROM team_application)
          OR file."milestoneDocumentSubmissionId" IN (SELECT id FROM team_submission)
          OR file."milestoneDocumentSubmissionHistoryId" IN (SELECT id FROM team_submission_history)
      ),
      team_repository AS (
        SELECT
          repository.id,
          repository."programId",
          repository."applicationId",
          repository."teamId"
        FROM "GithubRepository" AS repository
        WHERE repository."teamId" = ${teamId}
          OR repository."applicationId" IN (SELECT id FROM team_application)
      ),
      team_provision_job AS (
        SELECT job.id
        FROM "RepositoryProvisionJob" AS job
        WHERE job."applicationId" IN (SELECT id FROM team_application)
      ),
      team_outbox_event AS (
        SELECT event.id
        FROM "OutboxEvent" AS event
        WHERE event."aggregateType" = 'Application'
          AND event."aggregateId" IN (SELECT id FROM team_application)
      ),
      team_decision_notification AS (
        SELECT notification.id
        FROM "Notification" AS notification
        WHERE notification.type = 'APPLICATION_DECISION'
          AND notification.payload->>'applicationId' IN (SELECT id FROM team_application)
      ),
      team_notification AS (
        SELECT id FROM team_decision_notification
        UNION ALL
        SELECT acknowledgement.id
        FROM "Notification" AS acknowledgement
        WHERE acknowledgement.type = 'APPLICATION_DECISION_ACKNOWLEDGED'
          AND acknowledgement."idempotencyKey" IN (
            SELECT CONCAT('application-decision-acknowledged:', id)
            FROM team_decision_notification
          )
      )
      SELECT
        (SELECT count(*) FROM team_application) AS applications,
        (SELECT count(*) FROM "TeamMember" WHERE "teamId" = ${teamId}) AS members,
        (SELECT count(*) FROM "TeamInvitation" WHERE "teamId" = ${teamId}) AS invitations,
        (SELECT count(*) FROM team_submission) AS submissions,
        (
          (SELECT count(*) FROM team_submission_file)
          + (SELECT count(*) FROM team_submission_history)
        ) AS "submissionEvents",
        (SELECT count(*) FROM team_repository) AS "detachedRepositories",
        (
          SELECT MD5(COALESCE(STRING_AGG(scope."key", '|' ORDER BY scope."key"), ''))
          FROM (
            SELECT CONCAT('Application:', id) AS "key" FROM team_application
            UNION ALL
            SELECT CONCAT('TeamMember:', JSONB_BUILD_ARRAY("teamId", "userId")::text) FROM "TeamMember" WHERE "teamId" = ${teamId}
            UNION ALL
            SELECT CONCAT('TeamInvitation:', id) FROM "TeamInvitation" WHERE "teamId" = ${teamId}
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmission:', id) FROM team_submission
            UNION ALL
            SELECT CONCAT('MilestoneDocumentSubmissionHistory:', id) FROM team_submission_history
            UNION ALL
            SELECT CONCAT('SubmissionFile:', id) FROM team_submission_file
            UNION ALL
            SELECT CONCAT('RepositoryProvisionJob:', id) FROM team_provision_job
            UNION ALL
            SELECT CONCAT(
              'GithubRepository:', repository.id, ':',
              COALESCE(repository."programId", ''), ':',
              COALESCE(repository."applicationId", ''), ':',
              COALESCE(repository."teamId", '')
            )
            FROM team_repository AS repository
            UNION ALL
            SELECT CONCAT('OutboxEvent:', id) FROM team_outbox_event
            UNION ALL
            SELECT CONCAT('Notification:', id) FROM team_notification
          ) AS scope
        ) AS "scopeFingerprint"
    `,
    );
    if (!row)
      throw new Error('Team deletion scope count query returned no result.');
    return {
      applications: Number(row.applications),
      members: Number(row.members),
      invitations: Number(row.invitations),
      submissions: Number(row.submissions),
      submissionEvents: Number(row.submissionEvents),
      detachedRepositories: Number(row.detachedRepositories),
      scopeFingerprint: row.scopeFingerprint,
    };
  }
}

export type ApplicationDecisionAction =
  | { readonly action: typeof APPLICATION_DECISION_ACTIONS.APPROVE }
  | {
      readonly action: typeof APPLICATION_DECISION_ACTIONS.REJECT;
      readonly reason: string;
    }
  | { readonly action: typeof APPLICATION_DECISION_ACTIONS.REVERT };

interface ApplicationParticipantRow {
  readonly id: string;
  readonly githubLogin: string;
}

export interface ApplicationDecisionTarget {
  readonly id: string;
  readonly programId: string;
  readonly programName: string;

  readonly applicantGithubLogin: string;
  readonly teamId: string | null;
  readonly status: ApplicationStatus;
  readonly repositoryProvisioningEnabled: boolean;
  readonly participants: readonly ApplicationParticipantRow[];
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
  readonly processedById: string | null;
  readonly processedAt: Date | null;
}

export interface ApplicationDecisionNotificationInput {
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly recipientUserIds: readonly string[];

  readonly decision: ApplicationStatus;
  readonly decidedAt: Date;
}

export interface ApplicationTransition {
  readonly applicationId: string;

  readonly expectedStatus: ApplicationStatus;
  readonly nextStatus: ApplicationStatus;
  readonly rejectionReason: string | null;

  readonly processedBy: { readonly id: string; readonly at: Date } | 'preserve';
}

interface RepositoryProvisionEventInput {
  readonly applicationId: string;
  readonly programId: string;
  readonly teamId: string | null;
  readonly collaboratorGithubLogins: readonly string[];
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
  readonly idempotencyKey: string;
  readonly requestedAt: Date;
}

export interface RepositoryProvisionEvent {
  readonly id: string;
}

export interface RepositoryProvisionJobSnapshot {
  readonly status: RepositoryProvisionJobStatus;
  readonly repositoryId: string | null;
}

export type ApplicationDecisionResult =
  | {
      readonly kind: 'APPROVED';
      readonly applicationId: string;
      readonly status: ApplicationStatus;
      readonly repositoryProvisioning: {
        readonly enabled: boolean;
        readonly eventId: string | null;
        readonly jobStatus: RepositoryProvisionJobStatus | null;
      };
    }
  | {
      readonly kind: 'REJECTED';
      readonly applicationId: string;
      readonly status: ApplicationStatus;
      readonly rejectionReason: string;
    }
  | {
      readonly kind: 'REVERTED';
      readonly applicationId: string;
      readonly status: ApplicationStatus;
    };

export type ApplicationDecisionCommand = {
  readonly action: string;
  readonly reason?: string;
};

export type ApplicationListStatus = (typeof APPLICATION_LIST_STATUSES)[number];

export type ApplicationListView = (typeof APPLICATION_LIST_VIEWS)[number];

export interface ApplicationListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ApplicationListStatus;
  readonly view: ApplicationListView;
}

type CreateApplicationAnswersInput = Readonly<Record<string, unknown>>;

export interface CreateApplicationInput {
  readonly inviteeUserIds?: readonly string[];
  readonly answers: CreateApplicationAnswersInput;

  readonly teamName: string | null;
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned: boolean;
}

export interface UpdateStudentApplicationInput {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly applicationTemplateVersion: number;
}

export interface CreatedApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string;
  readonly submittedAt: Date;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
}

export interface ApplicationListAnswers {
  readonly applicantName: string;
  readonly title: string;
  readonly summary: string;
}

export type RepositoryProvisioningJobStatus =
  'NOT_REQUESTED' | 'DISABLED' | RepositoryProvisionJobStatus | 'ANOMALOUS';

export type RepositoryProvisioningSafeErrorClass =
  'AUTH' | 'RATE_LIMIT' | 'UPSTREAM_REJECTED' | 'UNKNOWN';

export interface ApplicationRepositoryProvisioning {
  readonly enabled: boolean;
  readonly jobStatus: RepositoryProvisioningJobStatus;
  readonly updatedAt: Date;
  readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
}

export interface ApplicationListRepository {
  readonly url: string;
  readonly visibility: RepositoryVisibility;
}

export interface ApplicationListItem {
  readonly id: string;

  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: Date;
  readonly rejectionReason: string | null;
  readonly repositoryProvisioning: ApplicationRepositoryProvisioning;

  readonly repositoryConnectionMode: RepositoryConnectionMode;

  readonly repositoryUrl: string | null;
  readonly repository: ApplicationListRepository | null;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly participation: 'INDIVIDUAL' | 'TEAM';
  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
  } | null;
  readonly answers: ApplicationListAnswers;
}

export type ApplicationListRow = {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly rejectionReason: string | null;
  readonly teamId: string | null;
  readonly answers: Prisma.JsonValue;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
  readonly repository: {
    readonly id: string;
    readonly nameWithOwner: string;
    readonly visibility: RepositoryVisibility;
  } | null;
  readonly program: {
    readonly repositoryProvisioningEnabled: boolean;
  };
  readonly applicant: {
    readonly id: string;
    readonly nickname: string;
    readonly name: string | null;
  };
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly _count: { readonly members: number };
  } | null;
};

export type ApplicationListOutbox = {
  readonly status: OutboxEventStatus;
  readonly createdAt: Date;
};

export type ApplicationListProvisionJob = {
  readonly repositoryId: string | null;
  readonly status: RepositoryProvisionJobStatus;
  readonly updatedAt: Date;
  readonly lastErrorCode: string | null;
};

export interface ApplicationListSource {
  readonly row: ApplicationListRow;
  readonly outbox: ApplicationListOutbox | undefined;
  readonly job: ApplicationListProvisionJob | undefined;
}

export interface ApplicationListSourcePage {
  readonly items: readonly ApplicationListSource[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface ApplicationListPage {
  readonly items: readonly ApplicationListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface TeamManagementMember {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface TeamManagementListItem {
  readonly id: string;
  readonly programId: string;
  readonly teamMinSize: number;
  readonly status: ApplicationStatus;
  readonly submittedAt: Date;
  readonly rejectionReason: string | null;
  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly memberCount: number;
    readonly members: readonly TeamManagementMember[];
  } | null;
}

export interface TeamManagementListPage {
  readonly items: readonly TeamManagementListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface ApplicationReviewHistoryEntry {
  readonly id: string;
  readonly eventKind: ApplicationReviewEventKind;
  readonly revision: number;
  readonly actor: {
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly occurredAt: Date;
  readonly rejectionReason: string | null;
}

export interface StaffApplicationDetail {
  readonly application: ApplicationListItem;
  readonly reviewHistory: readonly ApplicationReviewHistoryEntry[];
}

export interface StaffDashboardApplicationCounts {
  readonly total: number;
  readonly submitted: number;
  readonly approved: number;
  readonly rejected: number;
}

export interface StaffDashboardProgramSummary {
  readonly coverId?: string | null;
  readonly coverExternalImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationPeriod: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };

  readonly endAt: Date;

  readonly lifecycle: ProgramLifecycle;
  readonly applications: StaffDashboardApplicationCounts;
  readonly teamManagementPath: string;
}

export interface StaffDashboardSummary {
  readonly programs: readonly StaffDashboardProgramSummary[];
}

type ApplicationWithProgram = PrismaTypes.ApplicationGetPayload<{
  include: {
    program: {
      select: { repositoryProvisioningEnabled: true; name: true };
    };
    applicant: { select: { id: true; nickname: true } };
    team: {
      select: {
        leader: { select: { id: true; nickname: true } };
        members: {
          select: { user: { select: { id: true; nickname: true } } };
        };
      };
    };
  };
}>;

type ApplicationDatabase = Pick<
  PrismaTypes.TransactionClient,
  | 'user'
  | 'program'
  | 'team'
  | 'teamMember'
  | 'teamInvitation'
  | 'application'
  | 'applicationReviewHistory'
  | 'auditLog'
  | '$queryRaw'
>;

interface LockedProgramPolicy {
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly lifecycle: ProgramLifecycle;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly applicationTemplateVersion: number;
}

type ApplicationLockedTeamRow = Readonly<{ id: string; leaderId: string }>;

export interface ApplicationsTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findTeamMinSize(programId: string): Promise<number | null>;
  countTeamMembers(teamId: string): Promise<number>;

  appendReviewHistory(
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory>;
  findApplicationById(
    applicationId: string,
  ): Promise<ApplicationDecisionTarget | null>;
  isCurrentTeamMember(teamId: string, userId: string): Promise<boolean>;
  findRepositoryProvisionJob(
    applicationId: string,
  ): Promise<RepositoryProvisionJobSnapshot | null>;
  findRepositoryProvisionEvent(
    idempotencyKey: string,
  ): Promise<RepositoryProvisionEvent | null>;

  discardRepositoryProvisionRequest(
    applicationId: string,
    discardedAt: Date,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void>;
  transitionApplication(input: ApplicationTransition): Promise<boolean>;
  createApplicationDecisionNotifications(
    input: ApplicationDecisionNotificationInput,
  ): Promise<void>;
  createRepositoryProvisionEvent(
    input: RepositoryProvisionEventInput,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<RepositoryProvisionEvent>;
}

export interface ApplicationStudentActor {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface ApplyProgramRecord {
  readonly id: string;
  readonly name: string;
  readonly lifecycle?: ProgramLifecycle;
  readonly category: ProgramCategory;
  readonly applicationTemplateVersion: number;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly repositoryProvisioningEnabled: boolean;
}

interface CreateTeamForApplicationInput {
  readonly programId: string;
  readonly name: string;
  readonly leaderId: string;
  readonly memberIds?: readonly string[];
}

interface CreatedTeamForApplication {
  readonly id: string;
  readonly name: string;
}

interface CreateApplicationRecordInput {
  readonly programId: string;
  readonly applicantId: string;
  readonly teamId: string;
  readonly answers: Prisma.InputJsonValue;
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
}

export interface ApplicationCreateStore {
  readonly auditLogWriter: AuditLogTransactionWriter;

  appendReviewHistory(
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory>;
  lockProgramForApply(programId: string): Promise<LockedProgramPolicy | null>;

  findExistingTeamMembership(
    programId: string,
    userId: string,
  ): Promise<CreatedTeamForApplication | null>;

  lockTeamForApply(teamId: string, userId: string): Promise<boolean>;

  countTeamMembers(teamId: string): Promise<number>;
  validateApplicationParticipants(input: {
    readonly programId: string;
    readonly actorId: string;
    readonly inviteeIds: readonly string[];
  }): Promise<
    'ok' | 'student-ineligible' | 'invitee-ineligible' | 'invitee-unavailable'
  >;
  createApplicationInvitations(input: {
    readonly teamId: string;
    readonly programId: string;
    readonly actorId: string;
    readonly inviteeIds: readonly string[];
  }): Promise<void>;
  createTeamWithLeader(
    input: CreateTeamForApplicationInput,
  ): Promise<CreatedTeamForApplication>;
  createApplication(
    input: CreateApplicationRecordInput,
  ): Promise<CreatedApplication>;
}

@Injectable()
export class ApplicationsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewHistory: ReviewHistoryWriterRepository,
    private readonly repositoryProvisionGenerationRepository: RepositoryProvisionGenerationRepository,
    private readonly platformRepository: PlatformRepository,
  ) {}

  async withTransaction<T>(
    operation: (store: ApplicationsTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(this.applicationsTransactionStore(transaction)),
    );
  }

  async withCreateTransaction<T>(
    operation: (store: ApplicationCreateStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(this.applicationCreateStore(transaction)),
    );
  }

  async findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<ApplicationStudentActor | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: {
        id: true,
        nickname: true,
        ...USER_PROFILE_NAME_SELECT,
      },
    });
    return user
      ? {
          id: user.id,
          nickname: user.nickname,
          name: user.name ?? null,
        }
      : null;
  }

  findProgramById(programId: string): Promise<ApplyProgramRecord | null> {
    return this.prisma.program.findUnique({
      where: { id: programId, lifecycle: { not: 'DELETED' } },
      select: {
        id: true,
        name: true,
        lifecycle: true,
        category: true,
        applicationTemplateVersion: true,
        applicationStartAt: true,
        applicationEndAt: true,
        repositoryProvisioningEnabled: true,
      },
    });
  }

  async findRepositoryProvisionEvent(
    idempotencyKey: string,
  ): Promise<RepositoryProvisionEvent | null> {
    const event = await this.prisma.outboxEvent.findUnique({
      where: { idempotencyKey },
    });
    return event ? toRepositoryProvisionEvent(event) : null;
  }

  async listApplicationsForProgram(
    programId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationListSourcePage> {
    const where = buildApplicationListWhere(
      this.platformRepository,
      programId,
      query,
    );
    const [rows, totalItems, outboxEvents, provisionJobs] =
      await this.prisma.$transaction(
        async (transaction) => {
          const [applicationRows, applicationCount] = await Promise.all([
            transaction.application.findMany({
              where,
              orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
              skip: (query.page - 1) * query.pageSize,
              take: query.pageSize,
              select: APPLICATION_LIST_SELECT,
            }),
            transaction.application.count({ where }),
          ]);
          const applicationIds = applicationRows.map((row) => row.id);
          if (applicationIds.length === 0) {
            return [applicationRows, applicationCount, [], []] as const;
          }
          const [events, jobs] = await Promise.all([
            transaction.outboxEvent.findMany({
              where: {
                idempotencyKey: {
                  in: applicationIds.map((id) => `repository-provision:${id}`),
                },
              },
              select: {
                idempotencyKey: true,
                status: true,
                createdAt: true,
              },
            }),
            transaction.repositoryProvisionJob.findMany({
              where: { applicationId: { in: applicationIds } },
              select: {
                applicationId: true,
                status: true,
                repositoryId: true,
                updatedAt: true,
                lastErrorCode: true,
              },
            }),
          ]);
          return [applicationRows, applicationCount, events, jobs] as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    const outboxByApplicationId = new Map(
      outboxEvents.map((event) => [
        event.idempotencyKey.slice('repository-provision:'.length),
        event,
      ]),
    );
    const jobByApplicationId = new Map(
      provisionJobs.map((job) => [job.applicationId, job]),
    );

    return {
      items: rows.map((row) => ({
        row,
        outbox: outboxByApplicationId.get(row.id),
        job: jobByApplicationId.get(row.id),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async findApplicationForStaff(
    applicationId: string,
  ): Promise<ApplicationListSource | null> {
    const [row, outbox, job] = await this.prisma.$transaction(
      async (transaction) => {
        const applicationRow = await transaction.application.findUnique({
          where: { id: applicationId },
          select: APPLICATION_LIST_SELECT,
        });
        if (applicationRow === null) {
          return [null, null, null] as const;
        }
        const [event, provisionJob] = await Promise.all([
          transaction.outboxEvent.findUnique({
            where: {
              idempotencyKey: `repository-provision:${applicationId}`,
            },
            select: { status: true, createdAt: true },
          }),
          transaction.repositoryProvisionJob.findUnique({
            where: { applicationId },
            select: {
              status: true,
              repositoryId: true,
              updatedAt: true,
              lastErrorCode: true,
            },
          }),
        ]);
        return [applicationRow, event, provisionJob] as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (row === null) return null;
    return { row, outbox: outbox ?? undefined, job: job ?? undefined };
  }

  async listReviewHistory(
    applicationId: string,
  ): Promise<readonly ApplicationReviewHistoryEntry[]> {
    const rows = await this.prisma.applicationReviewHistory.findMany({
      where: { applicationId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        eventKind: true,
        revision: true,
        occurredAt: true,
        rejectionReason: true,
        actor: {
          select: { nickname: true, ...USER_PROFILE_NAME_SELECT },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      eventKind: row.eventKind,
      revision: row.revision,
      occurredAt: row.occurredAt,
      rejectionReason: row.rejectionReason,
      actor: {
        name: row.actor.name ?? null,
        nickname: row.actor.nickname,
      },
    }));
  }

  async listTeamManagementForProgram(
    programId: string,
    query: ApplicationListQuery,
  ): Promise<TeamManagementListPage> {
    const where = buildTeamManagementListWhere(
      this.platformRepository,
      programId,
      query,
    );

    const buckets: readonly Prisma.ApplicationWhereInput[] =
      query.status === 'all'
        ? [
            { ...where, status: ApplicationStatus.SUBMITTED },
            { ...where, status: { not: ApplicationStatus.SUBMITTED } },
          ]
        : [where];
    const skip = (query.page - 1) * query.pageSize;

    const [rows, totalItems] = await this.prisma.$transaction(
      async (transaction) => {
        const total = await transaction.application.count({ where });
        const collected: TeamManagementListRow[] = [];
        let remainingSkip = skip;
        let remainingTake = query.pageSize;
        for (const bucket of buckets) {
          if (remainingTake <= 0) break;
          const bucketCount = await transaction.application.count({
            where: bucket,
          });
          if (remainingSkip >= bucketCount) {
            remainingSkip -= bucketCount;
            continue;
          }
          const chunk = await transaction.application.findMany({
            where: bucket,
            orderBy: TEAM_MANAGEMENT_ORDER_BY,
            skip: remainingSkip,
            take: remainingTake,
            select: TEAM_MANAGEMENT_LIST_SELECT,
          });
          collected.push(...chunk);
          remainingSkip = 0;
          remainingTake -= chunk.length;
        }
        return [collected, total] as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      items: rows.map(toTeamManagementListItem),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async listStaffDashboardSummary(): Promise<StaffDashboardSummary> {
    const programs = await this.prisma.program.findMany({
      where: { lifecycle: { not: 'DELETED' } },
      orderBy: [{ applicationStartAt: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      select: {
        cover: { select: { id: true, imageUrl: true } },
        id: true,
        name: true,
        trackType: true,
        applicationStartAt: true,
        applicationEndAt: true,
        endAt: true,
        lifecycle: true,
      },
    });

    if (programs.length === 0) {
      return { programs: [] };
    }

    const counts = await this.prisma.application.groupBy({
      by: ['programId', 'status'],
      where: { programId: { in: programs.map((program) => program.id) } },
      _count: { _all: true },
    });

    type MutableCounts = {
      total: number;
      submitted: number;
      approved: number;
      rejected: number;
    };
    const countsByProgram = new Map<string, MutableCounts>();
    for (const program of programs) {
      countsByProgram.set(program.id, {
        total: 0,
        submitted: 0,
        approved: 0,
        rejected: 0,
      });
    }

    for (const row of counts) {
      const bucket = countsByProgram.get(row.programId);
      if (!bucket) continue;
      const n = row._count._all;
      bucket.total += n;
      switch (row.status) {
        case ApplicationStatus.SUBMITTED:
          bucket.submitted += n;
          break;
        case ApplicationStatus.APPROVED:
          bucket.approved += n;
          break;
        case ApplicationStatus.REJECTED:
          bucket.rejected += n;
          break;
      }
    }

    return {
      programs: programs.map((program) => {
        const applications: StaffDashboardApplicationCounts =
          countsByProgram.get(program.id) ?? {
            total: 0,
            submitted: 0,
            approved: 0,
            rejected: 0,
          };
        return {
          coverId: program.cover?.id ?? null,
          coverExternalImageUrl: program.cover?.imageUrl ?? null,
          id: program.id,
          name: program.name,
          trackType: program.trackType,
          applicationPeriod: {
            startsAt: program.applicationStartAt,
            endsAt: program.applicationEndAt,
          },
          endAt: program.endAt,
          lifecycle: program.lifecycle,
          applications,
          teamManagementPath: `/programs/${encodeURIComponent(program.id)}/teams`,
        };
      }),
    };
  }

  private applicationsTransactionStore(
    transaction: PrismaTypes.TransactionClient,
  ): ApplicationsTransactionStore {
    return {
      auditLogWriter: transaction,
      findTeamMinSize: this.findTeamMinSizeIn.bind(this, transaction),
      countTeamMembers: this.countTeamMembersIn.bind(this, transaction),
      appendReviewHistory: this.appendReviewHistoryIn.bind(this, transaction),
      findApplicationById: this.findApplicationByIdIn.bind(this, transaction),
      isCurrentTeamMember: this.isCurrentTeamMemberIn.bind(this, transaction),
      findRepositoryProvisionJob: this.findRepositoryProvisionJobIn.bind(
        this,
        transaction,
      ),
      findRepositoryProvisionEvent: this.findRepositoryProvisionEventIn.bind(
        this,
        transaction,
      ),
      discardRepositoryProvisionRequest:
        this.discardRepositoryProvisionRequestIn.bind(this, transaction),
      transitionApplication: this.transitionApplicationIn.bind(
        this,
        transaction,
      ),
      createApplicationDecisionNotifications:
        this.createApplicationDecisionNotificationsIn.bind(this, transaction),
      createRepositoryProvisionEvent:
        this.createRepositoryProvisionEventIn.bind(this, transaction),
    };
  }

  private appendReviewHistoryIn(
    transaction: PrismaTypes.TransactionClient,
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory> {
    return this.reviewHistory.appendReviewHistory(transaction, input);
  }

  private async findApplicationByIdIn(
    transaction: PrismaTypes.TransactionClient,
    applicationId: string,
  ): Promise<ApplicationDecisionTarget | null> {
    const application = await transaction.application.findUnique({
      where: {
        id: applicationId,
        program: { lifecycle: { not: 'DELETED' } },
      },
      include: {
        program: {
          select: { repositoryProvisioningEnabled: true, name: true },
        },
        applicant: { select: { id: true, nickname: true } },
        team: {
          select: {
            leader: { select: { id: true, nickname: true } },
            members: {
              select: { user: { select: { id: true, nickname: true } } },
            },
          },
        },
      },
    });
    return application ? toApplicationDecisionTarget(application) : null;
  }

  private async isCurrentTeamMemberIn(
    transaction: PrismaTypes.TransactionClient,
    teamId: string,
    userId: string,
  ): Promise<boolean> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`,
    );
    return (
      (await transaction.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId } },
        select: { userId: true },
      })) !== null
    );
  }

  private async findRepositoryProvisionJobIn(
    transaction: PrismaTypes.TransactionClient,
    applicationId: string,
  ): Promise<RepositoryProvisionJobSnapshot | null> {
    const job = await transaction.repositoryProvisionJob.findUnique({
      where: { applicationId },
      select: { status: true, repositoryId: true },
    });
    return job;
  }

  private async findRepositoryProvisionEventIn(
    transaction: PrismaTypes.TransactionClient,
    idempotencyKey: string,
  ): Promise<RepositoryProvisionEvent | null> {
    const event = await transaction.outboxEvent.findUnique({
      where: { idempotencyKey },
    });
    return event ? toRepositoryProvisionEvent(event) : null;
  }

  private async discardRepositoryProvisionRequestIn(
    transaction: PrismaTypes.TransactionClient,
    applicationId: string,
    discardedAt: Date,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<void> {
    const job = (
      await transaction.$queryRaw<
        readonly {
          readonly currentEventId: string | null;
          readonly repositoryId: string | null;
          readonly repositorySource: RepositorySource | null;
        }[]
      >(Prisma.sql`
        SELECT
          job."currentEventId",
          job."repositoryId",
          (
            SELECT repository."source"
            FROM "GithubRepository" AS repository
            WHERE repository."id" = job."repositoryId"
          ) AS "repositorySource"
        FROM "RepositoryProvisionJob" AS job
        WHERE job."applicationId" = ${applicationId}
        FOR UPDATE
      `)
    )[0];
    const event = await transaction.outboxEvent.findUnique({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
      select: { id: true },
    });
    if (event !== null) {
      const ownsJob = job?.currentEventId === event.id;
      await this.repositoryProvisionGenerationRepository.writeRepositoryIssuanceHistory(
        transaction,
        {
          requestId: event.id,
          applicationId,
          repositoryId: ownsJob ? job.repositoryId : null,
          source: ownsJob ? job.repositorySource : null,
          outcome: RepositoryIssuanceOutcome.DISCARDED,
          closedAt: discardedAt,
        },
        parsePayload,
      );
    }

    await transaction.outboxEvent.deleteMany({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
    });
    await transaction.repositoryProvisionJob.deleteMany({
      where: { applicationId },
    });
  }

  private async transitionApplicationIn(
    transaction: PrismaTypes.TransactionClient,
    input: ApplicationTransition,
  ): Promise<boolean> {
    const data: {
      status: ApplicationStatus;
      rejectionReason: string | null;
      processedById?: string;
      processedAt?: Date;
    } = {
      status: input.nextStatus,
      rejectionReason: input.rejectionReason,
    };
    if (input.processedBy !== 'preserve') {
      data.processedById = input.processedBy.id;
      data.processedAt = input.processedBy.at;
    }
    const result = await transaction.application.updateMany({
      where: {
        id: input.applicationId,
        status: input.expectedStatus,
      },
      data,
    });
    return result.count === 1;
  }

  private async createApplicationDecisionNotificationsIn(
    transaction: PrismaTypes.TransactionClient,
    input: ApplicationDecisionNotificationInput,
  ): Promise<void> {
    if (input.recipientUserIds.length === 0) return;
    const decidedAt = input.decidedAt.toISOString();
    await transaction.notification.createMany({
      data: input.recipientUserIds.map((userId) => ({
        userId,
        type: 'APPLICATION_DECISION',
        channel: 'IN_APP',
        status: 'UNREAD',
        idempotencyKey: [
          'application-decision',
          input.applicationId,
          input.decision,
          decidedAt,
          userId,
        ].join(':'),
        payload: {
          schemaVersion: 1,
          applicationId: input.applicationId,
          programId: input.programId,
          programName: input.programName,
          decision: input.decision,
          decidedAt,
        },
      })),
    });
  }

  private async createRepositoryProvisionEventIn(
    transaction: PrismaTypes.TransactionClient,
    input: RepositoryProvisionEventInput,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<RepositoryProvisionEvent> {
    try {
      const event = await transaction.outboxEvent.create({
        data: {
          type: 'REPOSITORY_PROVISION_REQUESTED',
          aggregateType: 'Application',
          aggregateId: input.applicationId,
          idempotencyKey: input.idempotencyKey,
          payload: {
            applicationId: input.applicationId,
            programId: input.programId,
            teamId: input.teamId,
            requestedAt: input.requestedAt.toISOString(),
            collaboratorGithubLogins: input.collaboratorGithubLogins,
            repositoryConnectionMode: input.repositoryConnectionMode,
            repositoryUrl: input.repositoryUrl,
          },
        },
      });
      await this.repositoryProvisionGenerationRepository.transferProvisionGeneration(
        transaction,
        {
          applicationId: input.applicationId,
          newEventId: event.id,
          now: input.requestedAt,
        },
        parsePayload,
      );
      return toRepositoryProvisionEvent(event);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new RepositoryEventAlreadyExistsError();
      }
      throw error;
    }
  }

  private applicationCreateStore(
    database: ApplicationDatabase,
  ): ApplicationCreateStore {
    return {
      auditLogWriter: database,
      appendReviewHistory: this.appendCreateReviewHistoryIn.bind(
        this,
        database,
      ),
      lockProgramForApply: this.lockProgramForApplyIn.bind(this, database),
      findExistingTeamMembership: this.findExistingTeamMembershipIn.bind(
        this,
        database,
      ),
      countTeamMembers: this.countTeamMembersIn.bind(this, database),
      validateApplicationParticipants:
        this.validateApplicationParticipantsIn.bind(this, database),
      createApplicationInvitations: this.createApplicationInvitationsIn.bind(
        this,
        database,
      ),
      lockTeamForApply: this.lockTeamForApplyIn.bind(this, database),
      createTeamWithLeader: this.createTeamWithLeaderIn.bind(this, database),
      createApplication: this.createApplicationIn.bind(this, database),
    };
  }

  private appendCreateReviewHistoryIn(
    database: ApplicationDatabase,
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory> {
    return this.reviewHistory.appendReviewHistory(database, input);
  }

  private async lockProgramForApplyIn(
    database: ApplicationDatabase,
    programId: string,
  ): Promise<LockedProgramPolicy | null> {
    const rows = await database.$queryRaw<readonly LockedProgramPolicy[]>(
      Prisma.sql`SELECT "lifecycle", "applicationStartAt", "applicationEndAt", "applicationTemplateVersion", "teamMinSize", "teamMaxSize" FROM "Program" WHERE id = ${programId} AND "lifecycle" <> 'DELETED' FOR UPDATE`,
    );
    return rows[0] ?? null;
  }

  private async findTeamMinSizeIn(
    database: ApplicationDatabase,
    programId: string,
  ): Promise<number | null> {
    const program = await database.program.findUnique({
      where: { id: programId },
      select: { teamMinSize: true },
    });
    return program?.teamMinSize ?? null;
  }

  private async findExistingTeamMembershipIn(
    database: ApplicationDatabase,
    programId: string,
    userId: string,
  ): Promise<CreatedTeamForApplication | null> {
    const membership = await database.teamMember.findUnique({
      where: { programId_userId: { programId, userId } },
      select: { team: { select: { id: true, name: true } } },
    });
    return membership?.team ?? null;
  }

  private async validateApplicationParticipantsIn(
    database: ApplicationDatabase,
    input: Parameters<
      ApplicationCreateStore['validateApplicationParticipants']
    >[0],
  ): ReturnType<ApplicationCreateStore['validateApplicationParticipants']> {
    const ids = [...new Set([input.actorId, ...input.inviteeIds])].sort();
    await database.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`,
    );
    const activeStudents = await database.user.findMany({
      where: {
        id: { in: ids },
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: { id: true },
    });
    const eligible = new Set(activeStudents.map((user) => user.id));
    if (!eligible.has(input.actorId)) return 'student-ineligible';
    if (input.inviteeIds.some((id) => !eligible.has(id)))
      return 'invitee-ineligible';
    if (input.inviteeIds.length > 0) {
      const memberships = await database.teamMember.count({
        where: {
          programId: input.programId,
          userId: { in: [...input.inviteeIds] },
        },
      });
      if (memberships > 0) return 'invitee-unavailable';
    }
    return 'ok';
  }

  private async createApplicationInvitationsIn(
    database: ApplicationDatabase,
    input: Parameters<
      ApplicationCreateStore['createApplicationInvitations']
    >[0],
  ): Promise<void> {
    if (input.inviteeIds.length === 0) return;
    await database.teamInvitation.createMany({
      data: input.inviteeIds.map((inviteeId) => ({
        teamId: input.teamId,
        programId: input.programId,
        invitedById: input.actorId,
        inviteeId,
      })),
    });
  }

  private async countTeamMembersIn(
    database: ApplicationDatabase,
    teamId: string,
  ): Promise<number> {
    return database.teamMember.count({ where: { teamId } });
  }

  private async lockTeamForApplyIn(
    database: ApplicationDatabase,
    teamId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await database.$queryRaw<readonly ApplicationLockedTeamRow[]>(
      Prisma.sql`SELECT "id", "leaderId" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`,
    );
    const locked = rows[0];
    if (!locked || locked.leaderId !== userId) {
      return false;
    }

    const membership = await database.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { userId: true },
    });
    return membership !== null;
  }

  private async createTeamWithLeaderIn(
    database: ApplicationDatabase,
    input: CreateTeamForApplicationInput,
  ): Promise<CreatedTeamForApplication> {
    try {
      const team = await database.team.create({
        data: {
          programId: input.programId,
          name: input.name,
          leaderId: input.leaderId,
        },
        select: { id: true, name: true },
      });
      await database.teamMember.createMany({
        data: (input.memberIds ?? [input.leaderId]).map((userId) => ({
          teamId: team.id,
          programId: input.programId,
          userId,
        })),
      });
      return team;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApplicationTeamMembershipConflictError();
      }
      throw error;
    }
  }

  private async createApplicationIn(
    database: ApplicationDatabase,
    input: CreateApplicationRecordInput,
  ): Promise<CreatedApplication> {
    try {
      return await database.application.create({
        data: {
          programId: input.programId,
          applicantId: input.applicantId,
          teamId: input.teamId,
          answers: input.answers,
          applicationTemplateVersion: input.applicationTemplateVersion,
          isRepositoryPublicationPlanned: input.isRepositoryPublicationPlanned,
          repositoryConnectionMode: input.repositoryConnectionMode,
          repositoryUrl: input.repositoryUrl,
          status: ApplicationStatus.SUBMITTED,
        },
        select: {
          id: true,
          programId: true,
          status: true,
          teamId: true,
          submittedAt: true,
          isRepositoryPublicationPlanned: true,
          repositoryConnectionMode: true,
          repositoryUrl: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApplicationDuplicateError();
      }
      throw error;
    }
  }
}

function buildApplicationListWhere(
  platformRepository: PlatformRepository,
  programId: string,
  query: ApplicationListQuery,
): Prisma.ApplicationWhereInput {
  const statusWhere: Prisma.ApplicationWhereInput =
    query.status === 'all' ? {} : { status: query.status };

  const search = query.search;
  const searchWhere: Prisma.ApplicationWhereInput = search
    ? {
        OR: [
          {
            applicant: platformRepository.userProfileNameWhere(search),
          },
          {
            applicant: {
              nickname: { contains: search, mode: 'insensitive' },
            },
          },
          {
            team: {
              name: { contains: search, mode: 'insensitive' },
            },
          },
          {
            answers: {
              path: ['title'],
              string_contains: search,
            },
          },
          {
            answers: {
              path: ['applicantName'],
              string_contains: search,
            },
          },
        ],
      }
    : {};

  return {
    programId,
    ...statusWhere,
    ...searchWhere,
  };
}

function buildTeamManagementListWhere(
  platformRepository: PlatformRepository,
  programId: string,
  query: ApplicationListQuery,
): Prisma.ApplicationWhereInput {
  const base = buildApplicationListWhere(platformRepository, programId, query);
  if (!query.search || !Array.isArray(base.OR)) return base;
  return {
    ...base,
    OR: [
      ...base.OR,
      {
        team: {
          members: {
            some: {
              OR: [
                {
                  user: platformRepository.userProfileNameWhere(query.search),
                },
                {
                  user: {
                    nickname: {
                      contains: query.search,
                      mode: 'insensitive',
                    },
                  },
                },
              ],
            },
          },
        },
      },
    ],
  };
}

const TEAM_MANAGEMENT_ORDER_BY = [
  { submittedAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ApplicationOrderByWithRelationInput[];

const TEAM_MANAGEMENT_LIST_SELECT = {
  id: true,
  programId: true,
  program: { select: { teamMinSize: true } },
  status: true,
  submittedAt: true,
  rejectionReason: true,
  applicant: {
    select: { id: true, nickname: true, ...USER_PROFILE_NAME_SELECT },
  },
  team: {
    select: {
      id: true,
      name: true,
      _count: { select: { members: true } },
      members: {
        orderBy: { createdAt: 'asc' },
        select: {
          user: {
            select: { id: true, nickname: true, ...USER_PROFILE_NAME_SELECT },
          },
        },
      },
    },
  },
} satisfies Prisma.ApplicationSelect;

type TeamManagementListRow = Prisma.ApplicationGetPayload<{
  readonly select: typeof TEAM_MANAGEMENT_LIST_SELECT;
}>;

function toTeamManagementListItem(
  row: TeamManagementListRow,
): TeamManagementListItem {
  return {
    id: row.id,
    programId: row.programId,
    teamMinSize: row.program.teamMinSize,
    status: row.status,
    submittedAt: row.submittedAt,
    rejectionReason: row.rejectionReason,
    applicant: {
      id: row.applicant.id,
      name: row.applicant.name ?? null,
      nickname: row.applicant.nickname,
    },
    team:
      row.team === null
        ? null
        : {
            id: row.team.id,
            name: row.team.name,
            memberCount: row.team._count.members,
            members: row.team.members.map((member) => ({
              id: member.user.id,
              name: member.user.name ?? null,
              nickname: member.user.nickname,
            })),
          },
  };
}

const APPLICATION_LIST_SELECT = {
  id: true,
  programId: true,
  status: true,
  submittedAt: true,
  updatedAt: true,
  rejectionReason: true,
  teamId: true,
  answers: true,
  isRepositoryPublicationPlanned: true,

  repositoryConnectionMode: true,
  repositoryUrl: true,

  repository: {
    select: { id: true, nameWithOwner: true, visibility: true },
  },
  program: {
    select: { repositoryProvisioningEnabled: true },
  },
  applicant: {
    select: {
      id: true,
      nickname: true,
      ...USER_PROFILE_NAME_SELECT,
    },
  },
  team: {
    select: {
      id: true,
      name: true,
      _count: { select: { members: true } },
    },
  },
} satisfies Prisma.ApplicationSelect;

function toApplicationDecisionTarget(
  application: ApplicationWithProgram,
): ApplicationDecisionTarget {
  return {
    id: application.id,
    programId: application.programId,
    programName: application.program.name,

    applicantGithubLogin: application.applicant.nickname,
    teamId: application.teamId,
    status: application.status,
    repositoryProvisioningEnabled:
      application.program.repositoryProvisioningEnabled,
    participants: application.team
      ? [
          {
            id: application.team.leader.id,
            githubLogin: application.team.leader.nickname,
          },
          ...application.team.members.map((member) => ({
            id: member.user.id,
            githubLogin: member.user.nickname,
          })),
        ]
      : [
          {
            id: application.applicant.id,
            githubLogin: application.applicant.nickname,
          },
        ],
    repositoryConnectionMode: application.repositoryConnectionMode,
    repositoryUrl: application.repositoryUrl,
    processedById: application.processedById,
    processedAt: application.processedAt,
  };
}

function toRepositoryProvisionEvent(
  event: PrismaOutboxEvent,
): RepositoryProvisionEvent {
  return { id: event.id };
}

export interface StudentApplicationPolicy {
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly applicationTemplateVersion: number;
}

export interface OwnedStudentApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;

  readonly teamLeaderId: string;

  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly answers: Prisma.JsonValue;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly isRepositoryPublicationPlanned: boolean;

  readonly rejectionReason: string | null;
}

export interface UpdatePendingApplicationRecord {
  readonly programId: string;
  readonly studentId: string;
  readonly answers: Prisma.InputJsonValue;
  readonly applicationTemplateVersion: number;
}

export interface DeletePendingApplicationRecord {
  readonly programId: string;
  readonly studentId: string;
}

export type StudentApplicationMutationFailure =
  | { readonly kind: 'program-not-found' }
  | { readonly kind: 'application-not-found' }
  | { readonly kind: 'already-decided' }
  | { readonly kind: 'period-closed' }
  | { readonly kind: 'template-version-mismatch' };

export type UpdatePendingApplicationResult =
  | { readonly kind: 'updated'; readonly application: OwnedStudentApplication }
  | StudentApplicationMutationFailure;

export type DeletePendingApplicationResult =
  { readonly kind: 'cancelled' } | StudentApplicationMutationFailure;

const APPLICATION_SELECT = {
  id: true,
  programId: true,
  status: true,
  teamId: true,
  team: { select: { leaderId: true } },
  applicant: {
    select: { id: true, nickname: true, ...USER_PROFILE_NAME_SELECT },
  },
  answers: true,
  submittedAt: true,
  updatedAt: true,
  isRepositoryPublicationPlanned: true,
  rejectionReason: true,
} satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{
  readonly select: typeof APPLICATION_SELECT;
}>;

function toOwnedStudentApplication(
  row: ApplicationRow,
): OwnedStudentApplication {
  const { team, ...application } = row;
  return {
    ...application,
    teamLeaderId: team.leaderId,
    applicant: {
      id: row.applicant.id,
      name: row.applicant.name ?? null,
      nickname: row.applicant.nickname,
    },
  };
}

export type StudentApplicationManagementClock = () => Date;

@Injectable()
export class StudentApplicationManagementRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewHistory: ReviewHistoryWriterRepository,
    private readonly platformRepository: PlatformRepository,
    @Inject(STUDENT_APPLICATION_MANAGEMENT_CLOCK)
    private readonly clock: StudentApplicationManagementClock = () =>
      new Date(),
  ) {}

  async findOwnedApplication(
    programId: string,
    studentId: string,
  ): Promise<OwnedStudentApplication | null> {
    const row = await this.prisma.application.findFirst({
      where: {
        programId,
        ...this.platformRepository.programApplicationParticipantWhere(
          studentId,
        ),
      },
      select: APPLICATION_SELECT,
    });
    return row ? toOwnedStudentApplication(row) : null;
  }

  updatePendingApplication(
    input: UpdatePendingApplicationRecord,
  ): Promise<UpdatePendingApplicationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const policy = await this.lockProgram(transaction, input.programId);
      if (!policy) return { kind: 'program-not-found' };
      const application = await this.lockManagedApplication(
        transaction,
        input.programId,
        input.studentId,
      );
      if (!application) return { kind: 'application-not-found' };
      const now = this.clock();
      const failure = this.validateMutation(
        application,
        policy,
        now,
        RESUBMITTABLE_STATUSES,
      );
      if (failure) return failure;
      if (
        input.applicationTemplateVersion !== policy.applicationTemplateVersion
      ) {
        return { kind: 'template-version-mismatch' };
      }

      const resubmitted = application.status === ApplicationStatus.REJECTED;
      const row = await transaction.application.update({
        where: { id: application.id },
        data: {
          answers: input.answers,
          applicationTemplateVersion: policy.applicationTemplateVersion,
          ...(resubmitted
            ? {
                status: ApplicationStatus.SUBMITTED,
                rejectionReason: null,
              }
            : {}),
        },
        select: APPLICATION_SELECT,
      });
      if (resubmitted) {
        await this.appendReviewHistoryIn(transaction, {
          applicationId: application.id,
          eventKind: ApplicationReviewEventKind.RESUBMITTED,
          actorId: input.studentId,
          occurredAt: now,
          rejectionReason: null,
        });
      }
      return { kind: 'updated', application: toOwnedStudentApplication(row) };
    });
  }

  deletePendingApplication(
    input: DeletePendingApplicationRecord,
  ): Promise<DeletePendingApplicationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const policy = await this.lockProgram(transaction, input.programId);
      if (!policy) return { kind: 'program-not-found' };
      const application = await this.lockManagedApplication(
        transaction,
        input.programId,
        input.studentId,
      );
      if (!application) return { kind: 'application-not-found' };
      const failure = this.validateMutation(
        application,
        policy,
        this.clock(),
        CANCELLABLE_STATUSES,
      );
      if (failure) return failure;
      await transaction.application.delete({ where: { id: application.id } });
      return { kind: 'cancelled' };
    });
  }

  private async lockProgram(
    transaction: Prisma.TransactionClient,
    programId: string,
  ): Promise<StudentApplicationPolicy | null> {
    const locked = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "Program" WHERE "id" = ${programId} AND "lifecycle" <> 'DELETED' FOR UPDATE
    `;
    if (locked.length === 0) return null;
    return transaction.program.findUnique({
      where: { id: programId },
      select: {
        applicationStartAt: true,
        applicationEndAt: true,
        applicationTemplateVersion: true,
      },
    });
  }

  private async lockManagedApplication(
    transaction: Prisma.TransactionClient,
    programId: string,
    studentId: string,
  ): Promise<OwnedStudentApplication | null> {
    const membership = await transaction.teamMember.findUnique({
      where: { programId_userId: { programId, userId: studentId } },
      select: { teamId: true },
    });
    if (!membership) return null;
    const lockedTeam = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "Team" WHERE "id" = ${membership.teamId} FOR UPDATE
    `;
    if (lockedTeam.length === 0) return null;

    const current = await transaction.teamMember.findUnique({
      where: { programId_userId: { programId, userId: studentId } },
      select: { teamId: true, team: { select: { leaderId: true } } },
    });
    if (!current || current.teamId !== membership.teamId) return null;
    if (current.team.leaderId !== studentId) return null;
    const candidate = await transaction.application.findFirst({
      where: {
        programId,
        ...this.platformRepository.programApplicationManagerWhere(studentId),
      },
      select: { id: true },
    });
    if (!candidate) return null;
    const locked = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "Application" WHERE "id" = ${candidate.id} FOR UPDATE
    `;
    if (locked.length === 0) return null;
    const row = await transaction.application.findFirst({
      where: {
        id: candidate.id,
        programId,
        ...this.platformRepository.programApplicationManagerWhere(studentId),
      },
      select: APPLICATION_SELECT,
    });
    return row ? toOwnedStudentApplication(row) : null;
  }

  private validateMutation(
    application: OwnedStudentApplication,
    policy: StudentApplicationPolicy,
    now: Date,
    allowedStatuses: readonly ApplicationStatus[],
  ): StudentApplicationMutationFailure | null {
    if (!allowedStatuses.includes(application.status)) {
      return { kind: 'already-decided' };
    }
    if (!(policy.applicationStartAt <= now && now <= policy.applicationEndAt)) {
      return { kind: 'period-closed' };
    }
    return null;
  }

  private appendReviewHistoryIn(
    transaction: Prisma.TransactionClient,
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory> {
    return this.reviewHistory.appendReviewHistory(transaction, input);
  }
}

export interface TeamStudentActor {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface TeamProgramRecord {
  readonly id: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
}

export interface TeamDetailRecord {
  readonly id: string;
  readonly name: string;
  readonly leaderId: string;
  readonly programId: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly hasApplication: boolean;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
  }[];
}

export interface StaffTeamRecord {
  readonly id: string;
  readonly name: string;
  readonly leaderId: string;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
  }[];
}

export interface RepositoryUrlHistoryScopedRows extends RepositoryUrlHistoryRows {
  readonly applicationId: string | null;
}

export interface TeamApplicationRow {
  readonly id: string;
  readonly status: TeamApplicationView['status'];
  readonly repositoryConnectionMode: TeamApplicationView['repositoryConnectionMode'];
  readonly repositoryUrl: string | null;
  readonly updatedAt: Date;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repository: {
    readonly id: string;
    readonly nameWithOwner: string;
    readonly visibility: 'PUBLIC' | 'PRIVATE';
  } | null;
  readonly program: {
    readonly endAt: Date;
    readonly repositoryProvisioningEnabled: boolean;
    readonly milestones: readonly {
      readonly id: string;
      readonly documents: readonly {
        readonly id: string;
      }[];
    }[];
  };
  readonly milestoneDocumentSubmissions: readonly SubmissionCompletionTargetRow[];
  readonly outbox: {
    readonly status: OutboxEventStatus;
    readonly createdAt: Date;
  } | null;
  readonly job: {
    readonly status: RepositoryProvisionJobStatus;
    readonly updatedAt: Date;
    readonly lastErrorCode: string | null;
    readonly repositoryId: string | null;
  } | null;
}

export interface StaffTeamDetailRecord {
  readonly repositoryContributions: TeamRepositoryContributionsRow | null;
  readonly repositoryUrlHistory: RepositoryUrlHistoryRows;
  readonly id: string;
  readonly name: string;
  readonly leaderId: string;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
  }[];
  readonly application: TeamApplicationRow | null;
}

export type TeamLeaveResult =
  'removed' | 'not-found' | 'last-member-with-application';

export type TeamRemoveMemberResult =
  | 'removed'
  | 'actor-not-in-team'
  | 'not-leader'
  | 'self-target'
  | 'target-not-found';

export type StaffRemoveMemberResult =
  'removed' | 'forbidden' | 'not-found' | 'last-member-with-application';

export type StaffTransferLeaderResult =
  'transferred' | 'unchanged' | 'forbidden' | 'not-found';

export type TeamRenameResult = 'renamed' | 'not-found' | 'forbidden';

export interface TeamRenameAuditEvent {
  readonly teamId: string;
  readonly programName: string;
  readonly previousName: string;
  readonly nextName: string;
}

export type RecordTeamRenameAudit = (
  store: TeamMembershipAuditStore,
  event: TeamRenameAuditEvent,
) => Promise<void>;

export interface TeamActorAuthority {
  readonly id: string;
  readonly isStaff: boolean;
}

type TeamMembershipOperation = 'LEAVE' | 'REMOVE' | 'TRANSFER_LEADER';

export interface TeamMembershipAuditEvent {
  readonly teamId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly operation: TeamMembershipOperation;

  readonly removedUserId: string | null;
  readonly previousLeaderId: string;
  readonly nextLeaderId: string | null;
}

export interface TeamMembershipAuditStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
}

export type RecordTeamMembershipAudit = (
  store: TeamMembershipAuditStore,
  event: TeamMembershipAuditEvent,
) => Promise<void>;

@Injectable()
export class TeamRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: ProgramTeamRepositoryEvidenceRepository,
    private readonly platformRepository: PlatformRepository,
    private readonly history: TeamHistoryRepository,
  ) {}
  async findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<TeamStudentActor | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: {
        id: true,
        nickname: true,
        ...USER_PROFILE_NAME_SELECT,
      },
    });
    return user
      ? {
          id: user.id,
          nickname: user.nickname,
          name: user.name ?? null,
        }
      : null;
  }
  async findActorAuthorityByGithubId(
    githubId: bigint,
  ): Promise<TeamActorAuthority | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        ...USER_AUTHORITY_SELECT,
        accountStatus: true,
      },
    });
    if (user?.accountStatus !== AccountStatus.ACTIVE) return null;
    return {
      id: user.id,
      isStaff:
        user.type === 'STAFF' &&
        user.approvalStatus === 'APPROVED' &&
        user.profileCreatedAt !== null &&
        user.name !== null &&
        user.department !== null,
    };
  }
  async renameTeam(
    programId: string,
    teamId: string,
    actor: TeamActorAuthority,
    name: string,
    recordAudit: RecordTeamRenameAudit,
  ): Promise<TeamRenameResult> {
    return this.prisma.$transaction(async (tx) => {
      if ((await lockTeamRow(tx, teamId)).length === 0) return 'not-found';
      const team = await tx.team.findUnique({
        where: { id: teamId, program: { lifecycle: { not: 'DELETED' } } },
        select: {
          programId: true,
          name: true,
          leaderId: true,
          program: { select: { name: true } },
        },
      });
      if (!team || team.programId !== programId) return 'not-found';
      const currentActor = await tx.user.findFirst({
        where: {
          id: actor.id,
          accountStatus: AccountStatus.ACTIVE,
          OR: [
            STUDENT_MEMBER_WHERE,
            {
              type: 'STAFF',
              approvalStatus: 'APPROVED',
              profileCreatedAt: { not: null },
              name: { not: null },
              department: { not: null },
            },
          ],
        },
        select: { type: true },
      });
      if (
        currentActor === null ||
        (currentActor.type !== 'STAFF' && team.leaderId !== actor.id)
      )
        return 'forbidden';
      if (team.name === name) return 'renamed';
      await tx.team.update({ where: { id: teamId }, data: { name } });
      await recordAudit(
        { auditLogWriter: tx },
        {
          teamId,
          programName: team.program.name,
          previousName: team.name,
          nextName: name,
        },
      );
      return 'renamed';
    });
  }
  findProgramById(programId: string): Promise<TeamProgramRecord | null> {
    return this.prisma.program.findUnique({
      where: { id: programId, lifecycle: { not: 'DELETED' } },
      select: {
        id: true,
        name: true,
        category: true,
        applicationStartAt: true,
        applicationEndAt: true,
        teamMinSize: true,
        teamMaxSize: true,
      },
    });
  }
  async findTeamDetailForUser(
    programId: string,
    userId: string,
  ): Promise<TeamDetailRecord | null> {
    const membership = await this.prisma.teamMember.findUnique({
      where: {
        programId_userId: { programId, userId },
      },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            leaderId: true,
            programId: true,
            program: {
              select: { teamMinSize: true, teamMaxSize: true },
            },
            applications: { select: { id: true }, take: 1 },
            members: {
              select: {
                userId: true,
                user: {
                  select: {
                    nickname: true,
                    ...USER_PROFILE_NAME_SELECT,
                  },
                },
              },
              orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
            },
          },
        },
      },
    });
    if (!membership) return null;
    const team = membership.team;
    return {
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      programId: team.programId,
      teamMinSize: team.program.teamMinSize,
      teamMaxSize: team.program.teamMaxSize,
      hasApplication: team.applications.length > 0,
      members: team.members.map((member) => ({
        userId: member.userId,
        nickname: member.user.nickname,
        name: member.user.name ?? null,
      })),
    };
  }
  async listStaffTeams(programId: string): Promise<StaffTeamRecord[]> {
    const teams = await this.prisma.team.findMany({
      where: { programId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        leaderId: true,
        members: {
          select: {
            userId: true,
            user: {
              select: {
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      members: team.members.map((member) => ({
        userId: member.userId,
        nickname: member.user.nickname,
        name: member.user.name ?? null,
      })),
    }));
  }
  async findStaffTeamDetail(
    programId: string,
    teamId: string,
  ): Promise<StaffTeamDetailRecord | null> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, programId },
      select: {
        id: true,
        name: true,
        leaderId: true,
        members: {
          select: {
            userId: true,
            user: {
              select: {
                githubId: true,
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!team) return null;
    const application = await this.prisma.application.findFirst({
      where: { programId, teamId },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        repositoryConnectionMode: true,
        repositoryUrl: true,
        isRepositoryPublicationPlanned: true,
        repository: {
          select: {
            id: true,
            nameWithOwner: true,
            visibility: true,
            lastSuccessAt: true,
            failureCount: true,
          },
        },
        program: {
          select: {
            id: true,
            startAt: true,
            repositoryProvisioningEnabled: true,
            endAt: true,
            milestones: {
              select: {
                id: true,
                documents: {
                  where: {
                    required: true,
                  },
                  select: { id: true },
                },
              },
            },
          },
        },
        milestoneDocumentSubmissions: {
          select: {
            status: true,
            milestoneDocument: { select: { id: true, milestoneId: true } },
          } satisfies PrismaTypes.MilestoneDocumentSubmissionSelect,
        },
      },
    });
    let applicationRow: TeamApplicationRow | null = null;
    if (application) {
      const [outbox, job] = await Promise.all([
        this.prisma.outboxEvent.findUnique({
          where: { idempotencyKey: `repository-provision:${application.id}` },
          select: { status: true, createdAt: true },
        }),
        this.prisma.repositoryProvisionJob.findUnique({
          where: { applicationId: application.id },
          select: {
            status: true,
            updatedAt: true,
            lastErrorCode: true,
            repositoryId: true,
          },
        }),
      ]);
      applicationRow = { ...application, outbox, job };
    }
    return {
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      members: team.members.map((member) => ({
        userId: member.userId,
        nickname: member.user.nickname,
        name: member.user.name ?? null,
      })),
      application: applicationRow,
      repositoryContributions: application
        ? await this.evidence.contributions(application, team.members)
        : null,
      repositoryUrlHistory: application
        ? await this.evidence.history({
            programId,
            teamId,
            applicationId: application.id,
          })
        : { rows: [], hasMore: false },
    };
  }
  async findStaffRepositoryUrlHistory(
    programId: string,
    teamId: string,
    cursor?: RepositoryUrlHistoryCursor,
  ): Promise<RepositoryUrlHistoryScopedRows | null> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, programId },
      select: { id: true },
    });
    if (!team) return null;
    const application = await this.prisma.application.findFirst({
      where: { programId, teamId },
      select: { id: true },
    });
    if (!application) return { applicationId: null, rows: [], hasMore: false };
    return {
      applicationId: application.id,
      ...(await this.evidence.history(
        { programId, teamId, applicationId: application.id },
        cursor,
      )),
    };
  }
  async findTeamActivityScope(
    programId: string,
    teamId: string,
  ): Promise<TeamActivityScope | null> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, programId },
      select: {
        leaderId: true,
        program: { select: { startAt: true, endAt: true } },
        members: {
          orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
          select: {
            userId: true,
            user: { select: { githubId: true, nickname: true } },
          },
        },
        applications: {
          where: { programId },
          take: 1,
          select: {
            id: true,
            status: true,
            repository: {
              select: {
                id: true,
                nameWithOwner: true,
                lastSuccessAt: true,
                failureCount: true,
              },
            },
          },
        },
      },
    });
    if (!team) return null;
    const { applications, ...scope } = team;
    return { ...scope, application: applications[0] ?? null };
  }
  readTeamActivity(team: TeamActivityScope): Promise<TeamActivityRow> {
    return this.evidence.activity(team);
  }
  async leave(
    programId: string,
    userId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<TeamLeaveResult> {
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId } },
        select: { teamId: true },
      });
      if (!membership) return 'not-found';
      if ((await lockTeamRow(tx, membership.teamId)).length === 0)
        return 'not-found';
      const lockedMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!lockedMembership || lockedMembership.teamId !== membership.teamId) {
        return 'not-found';
      }
      const now = new Date();
      const teamId = lockedMembership.teamId;
      const previousLeaderId = lockedMembership.team.leaderId;
      const [memberCount, application] = await Promise.all([
        tx.teamMember.count({ where: { teamId } }),
        tx.application.findFirst({ where: { teamId }, select: { id: true } }),
      ]);
      if (memberCount <= 1) {
        if (application !== null) return 'last-member-with-application';
        await tx.teamMember.delete({
          where: { teamId_userId: { teamId, userId } },
        });
        await this.history.recordTeamInvitationsDeleted(
          tx,
          teamId,
          userId,
          now,
        );
        await tx.teamInvitation.deleteMany({ where: { teamId, programId } });
        await tx.team.delete({ where: { id: teamId } });
        await recordAudit(
          { auditLogWriter: tx },
          membershipAuditEvent(lockedMembership, {
            operation: 'LEAVE',
            removedUserId: userId,
            previousLeaderId,
            nextLeaderId: null,
          }),
        );
        return 'removed';
      }
      let nextLeaderId = previousLeaderId;
      if (previousLeaderId === userId) {
        const successor = await tx.teamMember.findFirst({
          where: { teamId, userId: { not: userId } },
          orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
          select: { userId: true },
        });
        if (!successor) {
          throw new Error(
            'team member count and roster disagree inside the team lock',
          );
        }
        nextLeaderId = successor.userId;
        await tx.team.update({
          where: { id: teamId },
          data: { leaderId: nextLeaderId },
        });
      }
      await tx.teamMember.delete({
        where: { teamId_userId: { teamId, userId } },
      });
      await enqueueRepositoryAccessSyncEvents(
        this.platformRepository,
        tx,
        teamId,
        now,
      );
      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(lockedMembership, {
          operation: 'LEAVE',
          removedUserId: userId,
          previousLeaderId,
          nextLeaderId,
        }),
      );
      return 'removed';
    });
  }
  async removeMember(
    programId: string,
    actorUserId: string,
    targetUserId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<TeamRemoveMemberResult> {
    return this.prisma.$transaction(async (tx) => {
      const actorMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: actorUserId } },
        select: { teamId: true },
      });
      if (!actorMembership) return 'actor-not-in-team';
      if ((await lockTeamRow(tx, actorMembership.teamId)).length === 0)
        return 'actor-not-in-team';
      const lockedActor = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: actorUserId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!lockedActor || lockedActor.teamId !== actorMembership.teamId) {
        return 'actor-not-in-team';
      }
      const now = new Date();
      const teamId = lockedActor.teamId;
      const leaderId = lockedActor.team.leaderId;
      if (leaderId !== actorUserId) return 'not-leader';
      if (targetUserId === actorUserId) return 'self-target';
      const targetMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: targetUserId } },
        select: { teamId: true },
      });
      if (!targetMembership || targetMembership.teamId !== teamId) {
        return 'target-not-found';
      }
      await tx.teamMember.delete({
        where: { teamId_userId: { teamId, userId: targetUserId } },
      });
      await enqueueRepositoryAccessSyncEvents(
        this.platformRepository,
        tx,
        teamId,
        now,
      );
      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(lockedActor, {
          operation: 'REMOVE',
          removedUserId: targetUserId,
          previousLeaderId: leaderId,
          nextLeaderId: leaderId,
        }),
      );
      return 'removed';
    });
  }
  async removeMemberForStaff(
    programId: string,
    teamId: string,
    actorUserId: string,
    targetUserId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<StaffRemoveMemberResult> {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: { programId: true },
      });
      if (!team || team.programId !== programId) return 'not-found';
      if ((await lockTeamRow(tx, teamId)).length === 0) return 'not-found';
      if (!(await isActiveStaff(tx, actorUserId))) return 'forbidden';
      const target = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: targetUserId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!target || target.teamId !== teamId) return 'not-found';
      const now = new Date();
      const previousLeaderId = target.team.leaderId;
      const [memberCount, application] = await Promise.all([
        tx.teamMember.count({ where: { teamId } }),
        tx.application.findFirst({ where: { teamId }, select: { id: true } }),
      ]);
      if (memberCount <= 1) {
        if (application !== null) return 'last-member-with-application';
        await tx.teamMember.delete({
          where: { teamId_userId: { teamId, userId: targetUserId } },
        });
        await this.history.recordTeamInvitationsDeleted(
          tx,
          teamId,
          actorUserId,
          now,
        );
        await tx.teamInvitation.deleteMany({ where: { teamId, programId } });
        await tx.team.delete({ where: { id: teamId } });
        await recordAudit(
          { auditLogWriter: tx },
          membershipAuditEvent(target, {
            operation: 'REMOVE',
            removedUserId: targetUserId,
            previousLeaderId,
            nextLeaderId: null,
          }),
        );
        return 'removed';
      }
      let nextLeaderId = previousLeaderId;
      if (previousLeaderId === targetUserId) {
        const successor = await tx.teamMember.findFirst({
          where: { teamId, userId: { not: targetUserId } },
          orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
          select: { userId: true },
        });
        if (!successor) {
          throw new Error(
            'team member count and roster disagree inside the team lock',
          );
        }
        nextLeaderId = successor.userId;
        await tx.team.update({
          where: { id: teamId },
          data: { leaderId: nextLeaderId },
        });
      }
      await tx.teamMember.delete({
        where: { teamId_userId: { teamId, userId: targetUserId } },
      });
      await enqueueRepositoryAccessSyncEvents(
        this.platformRepository,
        tx,
        teamId,
        now,
      );
      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(target, {
          operation: 'REMOVE',
          removedUserId: targetUserId,
          previousLeaderId,
          nextLeaderId,
        }),
      );
      return 'removed';
    });
  }
  async transferLeaderForStaff(
    programId: string,
    teamId: string,
    actorUserId: string,
    targetUserId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<StaffTransferLeaderResult> {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: { programId: true },
      });
      if (!team || team.programId !== programId) return 'not-found';
      if ((await lockTeamRow(tx, teamId)).length === 0) return 'not-found';
      if (!(await isActiveStaff(tx, actorUserId))) return 'forbidden';
      const target = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: targetUserId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!target || target.teamId !== teamId) return 'not-found';
      const previousLeaderId = target.team.leaderId;
      if (previousLeaderId === targetUserId) return 'unchanged';
      await tx.team.update({
        where: { id: teamId },
        data: { leaderId: targetUserId },
      });
      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(target, {
          operation: 'TRANSFER_LEADER',
          removedUserId: null,
          previousLeaderId,
          nextLeaderId: targetUserId,
        }),
      );
      return 'transferred';
    });
  }
}

async function isActiveStaff(
  tx: Pick<Prisma.TransactionClient, 'user'>,
  userId: string,
): Promise<boolean> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      ...USER_AUTHORITY_SELECT,
      accountStatus: true,
    },
  });
  if (user?.accountStatus !== AccountStatus.ACTIVE) return false;
  return (
    user.type === 'STAFF' &&
    user.approvalStatus === 'APPROVED' &&
    user.profileCreatedAt !== null &&
    user.name !== null &&
    user.department !== null
  );
}

const TEAM_MEMBERSHIP_CONTEXT_SELECT = {
  teamId: true,
  team: {
    select: {
      leaderId: true,
      name: true,
      program: { select: { name: true } },
    },
  },
} satisfies Prisma.TeamMemberSelect;

interface TeamMembershipContext {
  readonly teamId: string;
  readonly team: {
    readonly leaderId: string;
    readonly name: string;
    readonly program: { readonly name: string };
  };
}

function membershipAuditEvent(
  context: TeamMembershipContext,
  change: Omit<TeamMembershipAuditEvent, 'teamId' | 'programName' | 'teamName'>,
): TeamMembershipAuditEvent {
  return {
    teamId: context.teamId,
    programName: context.team.program.name,
    teamName: context.team.name,
    ...change,
  };
}

type AccessSyncTx = Pick<
  Prisma.TransactionClient,
  'application' | 'outboxEvent'
>;

async function enqueueRepositoryAccessSyncEvents(
  platformRepository: PlatformRepository,
  tx: AccessSyncTx,
  teamId: string,
  now: Date,
): Promise<void> {
  const applications = await tx.application.findMany({
    where: platformRepository.repositoryAccessSyncTargetWhere(teamId),
    select: { id: true },
  });
  if (applications.length === 0) return;
  await tx.outboxEvent.createMany({
    data: applications.map((application) =>
      platformRepository.repositoryAccessSyncEventData(
        application.id,
        teamId,
        now,
      ),
    ),
    skipDuplicates: true,
  });
}

function lockTeamRow(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  teamId: string,
): Promise<LockedTeamRow[]> {
  return tx.$queryRaw<LockedTeamRow[]>(
    Prisma.sql`
      SELECT t."id" FROM "Team" t
      JOIN "Program" p ON p."id" = t."programId"
      WHERE t."id" = ${teamId} AND p."lifecycle" <> 'DELETED'
      FOR UPDATE OF t
    `,
  );
}

interface LockedTeamRow {
  readonly id: string;
}

type TeamDeletedCounts = Omit<TeamDeletionScopeCounts, 'scopeFingerprint'>;

export interface TeamDeletionAuditEvent {
  readonly teamId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly deletedCounts: TeamDeletedCounts;
}

export interface TeamDeletionAuditStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
}

export type RecordTeamDeletionAudit = (
  store: TeamDeletionAuditStore,
  event: TeamDeletionAuditEvent,
) => Promise<void>;

export interface TeamDeletionNotificationStore {
  createTeamDeletedNotifications(
    notifications: readonly TeamDeletionNotificationInput[],
  ): Promise<void>;
}

type TeamDeletionNotificationInput = {
  readonly userId: string;
  readonly type: 'TEAM_DELETED';
  readonly channel: 'IN_APP';
  readonly status: 'UNREAD';
  readonly idempotencyKey: string;
  readonly payload: {
    readonly schemaVersion: 1;
    readonly teamId: string;
    readonly teamName: string;
    readonly programId: string;
    readonly programName: string;
    readonly message: string | null;
    readonly deletedAt: string;
  };
};

export interface TeamDeletionNotificationEvent {
  readonly teamId: string;
  readonly teamName: string;
  readonly programId: string;
  readonly programName: string;

  readonly recipientUserIds: readonly string[];
  readonly deletedAt: Date;
}

export type RecordTeamDeletionNotification = (
  store: TeamDeletionNotificationStore,
  event: TeamDeletionNotificationEvent,
) => Promise<void>;

export type TeamDeletionResult =
  | { readonly outcome: 'deleted'; readonly deletedCounts: TeamDeletedCounts }
  | { readonly outcome: 'not-found' }
  | {
      readonly outcome: 'scope-changed';
      readonly currentScopeCounts: TeamDeletionScopeCounts;
    };

@Injectable()
export class ProgramTeamDeletionRepository {
  constructor(
    private readonly history: TeamHistoryRepository,
    private readonly prisma: PrismaService,
    private readonly teamDeletionScope: TeamDeletionScopeRepository,
    private readonly prismaSerializationRetryRepository: PrismaSerializationRetryRepository,
  ) {}

  readScopeCounts(teamId: string): Promise<TeamDeletionScopeCounts> {
    return this.prisma.$transaction((transaction) =>
      this.teamDeletionScope.readTeamDeletionScopeCounts(transaction, teamId),
    );
  }

  async deleteTeam(
    programId: string,
    teamId: string,
    actorId: string,
    expectedScope: TeamDeletionScopeCounts,
    recordAudit: RecordTeamDeletionAudit,
    recordNotification: RecordTeamDeletionNotification,
  ): Promise<TeamDeletionResult> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;

          const team = await tx.team.findUnique({
            where: {
              id: teamId,
              program: { lifecycle: { not: 'DELETED' } },
            },
            select: {
              programId: true,
              name: true,
              program: { select: { name: true } },
            },
          });
          if (!team || team.programId !== programId) {
            return { outcome: 'not-found' as const };
          }

          const currentScopeCounts =
            await this.teamDeletionScope.readTeamDeletionScopeCounts(
              tx,
              teamId,
            );
          if (
            !this.teamDeletionScope.sameCounts(
              expectedScope,
              currentScopeCounts,
            )
          ) {
            return {
              outcome: 'scope-changed' as const,
              currentScopeCounts,
            };
          }

          const recipients = await tx.teamMember.findMany({
            where: { teamId },
            select: { userId: true },
          });
          const deletedAt = new Date();
          await recordNotification(
            {
              async createTeamDeletedNotifications(notifications) {
                await tx.notification.createMany({
                  data: [...notifications],
                  skipDuplicates: true,
                });
              },
            },
            {
              teamId,
              teamName: team.name,
              programId,
              programName: team.program.name,
              recipientUserIds: recipients.map((recipient) => recipient.userId),
              deletedAt,
            },
          );

          await this.history.recordTeamInvitationsDeleted(
            tx,
            teamId,
            actorId,
            deletedAt,
          );
          const deletedCounts = await deleteTeamTree(tx, teamId);
          if (
            !this.teamDeletionScope.sameCountValues(
              currentScopeCounts,
              deletedCounts,
            )
          ) {
            throw new TeamDeletedScopeMismatchError();
          }
          await tx.team.delete({ where: { id: teamId } });

          await recordAudit(
            { auditLogWriter: tx },
            {
              teamId,
              programName: team.program.name,
              teamName: team.name,
              deletedCounts,
            },
          );

          return { outcome: 'deleted' as const, deletedCounts };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const serializationFailure =
        this.prismaSerializationRetryRepository.isSerializationFailure(error);
      const foreignKeyConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003';
      const deletedScopeMismatch =
        error instanceof TeamDeletedScopeMismatchError;
      if (
        !serializationFailure &&
        !foreignKeyConflict &&
        !deletedScopeMismatch
      ) {
        throw error;
      }
      return {
        outcome: 'scope-changed',
        currentScopeCounts: await this.readScopeCounts(teamId),
      };
    }
  }
}

async function deleteTeamTree(
  tx: PrismaTypes.TransactionClient,
  teamId: string,
): Promise<TeamDeletedCounts> {
  const now = new Date();
  const applicationIds = (
    await tx.application.findMany({
      where: { teamId },
      select: { id: true },
    })
  ).map((application) => application.id);

  if (applicationIds.length > 0) {
    await tx.outboxEvent.deleteMany({
      where: {
        aggregateType: 'Application',
        aggregateId: { in: applicationIds },
      },
    });
  }

  const decisionNotifications =
    applicationIds.length > 0
      ? await tx.notification.findMany({
          where: {
            type: 'APPLICATION_DECISION',
            OR: applicationIds.map((applicationId) => ({
              payload: { path: ['applicationId'], equals: applicationId },
            })),
          },
          select: { id: true },
        })
      : [];
  if (decisionNotifications.length > 0) {
    const decisionNotificationIds = decisionNotifications.map(
      (notification) => notification.id,
    );
    await tx.notification.deleteMany({
      where: {
        type: 'APPLICATION_DECISION_ACKNOWLEDGED',
        idempotencyKey: {
          in: decisionNotificationIds.map(
            (id) => `application-decision-acknowledged:${id}`,
          ),
        },
      },
    });
    await tx.notification.deleteMany({
      where: { id: { in: decisionNotificationIds } },
    });
  }

  const repositoryScope = {
    OR: [{ teamId }, { application: { is: { teamId } } }],
  } satisfies PrismaTypes.GithubRepositoryWhereInput;
  await tx.repositoryProvisionJob.deleteMany({
    where: { application: { teamId } },
  });
  await tx.repositoryInvitation.deleteMany({
    where: { repository: repositoryScope },
  });
  const githubRepositoriesDeleted = await tx.githubRepository.deleteMany({
    where: repositoryScope,
  });

  const fileScope = {
    OR: [
      { application: { is: { teamId } } },
      { milestoneDocumentSubmission: { is: { application: { teamId } } } },
      {
        submissionHistory: { is: { submission: { application: { teamId } } } },
      },
    ],
  } satisfies PrismaTypes.SubmissionFileWhereInput;
  const detachedFileFks = {
    applicationId: null,
    milestoneId: null,
    milestoneDocumentSubmissionId: null,
    milestoneDocumentSubmissionHistoryId: null,
  } as const;
  const pendingSubmissionFiles = await tx.submissionFile.updateMany({
    where: {
      AND: [fileScope, { lifecycle: { not: SubmissionFileLifecycle.DELETED } }],
    },
    data: {
      ...detachedFileFks,
      lifecycle: SubmissionFileLifecycle.DELETE_PENDING,
      deleteClaimedAt: null,
      deleteClaimExpiresAt: null,
      deleteClaimOwner: null,
      nextDeleteAttemptAt: now,
      lastDeleteError: null,
    },
  });
  const deletedSubmissionFiles = await tx.submissionFile.updateMany({
    where: {
      AND: [fileScope, { lifecycle: SubmissionFileLifecycle.DELETED }],
    },
    data: detachedFileFks,
  });

  await tx.$executeRaw(Prisma.sql`
    DELETE FROM "MilestoneDocumentReviewHistory"
    WHERE "milestoneDocumentSubmissionId" IN (
      SELECT "id" FROM "MilestoneDocumentSubmission"
      WHERE "applicationId" = ANY(${applicationIds}::text[])
    )
  `);
  const milestoneDocumentSubmissionHistories =
    await tx.milestoneDocumentSubmissionHistory.deleteMany({
      where: { submission: { application: { teamId } } },
    });
  const milestoneDocumentSubmissions =
    await tx.milestoneDocumentSubmission.deleteMany({
      where: { application: { teamId } },
    });

  const applications = await tx.application.deleteMany({ where: { teamId } });
  const teamInvitations = await tx.teamInvitation.deleteMany({
    where: { teamId },
  });
  const teamMembers = await tx.teamMember.deleteMany({ where: { teamId } });

  return {
    applications: applications.count,
    members: teamMembers.count,
    invitations: teamInvitations.count,
    submissions: milestoneDocumentSubmissions.count,
    submissionEvents:
      pendingSubmissionFiles.count +
      deletedSubmissionFiles.count +
      milestoneDocumentSubmissionHistories.count,
    detachedRepositories: githubRepositoriesDeleted.count,
  };
}

export type StudentRepositoryUrlContext = {
  readonly id: string;
  readonly programId: string;
  readonly teamId: string;
  readonly status: ApplicationStatus;
  readonly applicantId: string;
  readonly applicant: { readonly githubId: bigint };
  readonly team: { readonly leaderId: string };
  readonly program: { readonly name: string; readonly endAt: Date };
  readonly repository: {
    readonly id: string;
    readonly githubRepositoryId: bigint;
    readonly nameWithOwner: string;
  } | null;
};

export type TeamRepositoryUrlContext = StudentRepositoryUrlContext & {
  readonly editor: {
    readonly nickname: string;
    readonly isLeader: boolean;
    readonly isStaff: boolean;
  };
};

@Injectable()
export class StudentRepositoryUrlContextRepository {
  constructor(private readonly platformRepository: PlatformRepository) {}

  async readTeamRepositoryUrlContext(
    db: Prisma.TransactionClient,
    programId: string,
    teamId: string,
    actorGithubId: bigint,
  ): Promise<TeamRepositoryUrlContext | null> {
    const actor = await db.user.findFirst({
      where: { githubId: actorGithubId, accountStatus: AccountStatus.ACTIVE },
      select: {
        id: true,
        nickname: true,
        ...USER_AUTHORITY_SELECT,
      },
    });
    if (!actor) return null;
    const context = await db.application.findUnique({
      where: {
        programId_teamId: { programId, teamId },
        program: { lifecycle: { not: 'DELETED' } },
      },
      select: this.STUDENT_REPOSITORY_URL_SELECT,
    });
    if (!context) return null;
    const leads = await db.application.count({
      where: {
        id: context.id,
        AND: [
          this.platformRepository.programApplicationManagerWhere(actor.id),
          { team: { leader: STUDENT_MEMBER_WHERE } },
        ],
      },
    });
    return {
      ...context,
      editor: {
        nickname: actor.nickname,
        isLeader: leads === 1,
        isStaff:
          actor.type === 'STAFF' &&
          actor.approvalStatus === 'APPROVED' &&
          actor.profileCreatedAt !== null &&
          actor.name !== null &&
          actor.department !== null,
      },
    };
  }

  readonly STUDENT_REPOSITORY_URL_SELECT = {
    id: true,
    programId: true,
    teamId: true,
    status: true,
    applicantId: true,
    applicant: { select: { githubId: true } },
    team: { select: { leaderId: true } },
    program: { select: { name: true, endAt: true } },
    repository: {
      select: { id: true, githubRepositoryId: true, nameWithOwner: true },
    },
  } satisfies Prisma.ApplicationSelect;
}

@Injectable()
export class StudentRepositoryUrlTransactionRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly repositoryProvisionGenerationRepository: RepositoryProvisionGenerationRepository,
    private readonly studentRepositoryUrlContextRepository: StudentRepositoryUrlContextRepository,
    private readonly repositoryDeletion: RepositoryDeletionRepository,
  ) {}
  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async lockTeamContext(
    programId: string,
    teamId: string,
    actorGithubId: bigint,
  ): Promise<TeamRepositoryUrlContext | null> {
    await this.transaction
      .$queryRaw`SELECT "id" FROM "Program" WHERE "id" = ${programId} FOR UPDATE`;

    await this.transaction
      .$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} AND "programId" = ${programId} FOR UPDATE`;
    await this.transaction
      .$queryRaw`SELECT "id" FROM "Application" WHERE "programId" = ${programId} AND "teamId" = ${teamId} FOR UPDATE`;
    return this.studentRepositoryUrlContextRepository.readTeamRepositoryUrlContext(
      this.transaction,
      programId,
      teamId,
      actorGithubId,
    );
  }

  async relink(
    context: StudentRepositoryUrlContext,
    resolution: OwnGithubRepositoryResolution,
    parsePayload: RepositoryProvisionHistoryPayloadParser,
  ): Promise<{
    readonly repositoryId: string;
    readonly deletedCounts: RepositoryDeletionCounts | null;
  }> {
    const tx = this.transaction;
    await tx.$queryRaw`SELECT "id" FROM "RepositoryProvisionJob" WHERE "applicationId" = ${context.id} FOR UPDATE`;
    const job = await tx.repositoryProvisionJob.findUnique({
      where: { applicationId: context.id },
      select: { status: true },
    });
    if (job?.status === RepositoryProvisionJobStatus.PROCESSING)
      throw repositoryUrlError('busy');
    const metadata = resolution.repository;
    const existing = await tx.githubRepository.findUnique({
      where: { githubRepositoryId: metadata.githubRepositoryId },
      select: { id: true },
    });
    if (context.repository && context.repository.id !== existing?.id) {
      await tx.githubRepository.update({
        where: { id: context.repository.id },
        data: { applicationId: null, teamId: null },
      });
    }
    const data = {
      applicationId: context.id,
      programId: context.programId,
      teamId: context.teamId,
      nameWithOwner: metadata.nameWithOwner,
      visibility: metadata.visibility,
      presence: CollectionRepositoryPresence.PRESENT,
      nextRunAt: new Date(),
      failureCount: 0,
      source:
        resolution.kind === 'EXTERNAL'
          ? RepositorySource.EXTERNAL_PUBLIC
          : RepositorySource.ORG_PROVISIONED,
      ...(resolution.kind === 'EXTERNAL'
        ? {
            defaultBranch: resolution.repository.defaultBranch,
            archived: resolution.repository.archived,
            lastCompleteInventoryObservedAt: new Date(),
          }
        : {}),
    };
    let repositoryId: string;
    if (existing) {
      const result = await tx.githubRepository.updateMany({
        where: {
          id: existing.id,
          OR: [{ applicationId: null }, { applicationId: context.id }],
          AND: [
            { OR: [{ programId: null }, { programId: context.programId }] },
            { OR: [{ teamId: null }, { teamId: context.teamId }] },
          ],
        },
        data,
      });
      if (result.count !== 1) throw repositoryUrlError('conflict');
      repositoryId = existing.id;
    } else {
      const created = await tx.githubRepository.create({
        data: { ...data, githubRepositoryId: metadata.githubRepositoryId },
        select: { id: true },
      });
      repositoryId = created.id;
    }
    const repositoryUrl = `https://github.com/${metadata.nameWithOwner}`;

    await tx.application.update({
      where: { id: context.id },
      data: {
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl,
      },
    });

    await this.repositoryProvisionGenerationRepository.settleProvisionGenerationForSynchronousConnection(
      tx,
      { applicationId: context.id, repositoryId, now: new Date() },
      parsePayload,
    );
    const deletedCounts =
      context.repository && context.repository.id !== repositoryId
        ? await this.repositoryDeletion.deleteRepositoryWithFacts(
            tx,
            context.repository.id,
          )
        : null;
    return { repositoryId, deletedCounts };
  }

  isStudentRepositoryUrlConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}

@Injectable()
export class StudentRepositoryUrlRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
    private readonly studentRepositoryUrlContextRepository: StudentRepositoryUrlContextRepository,
    private readonly repositoryProvisionGenerationRepository: RepositoryProvisionGenerationRepository,
    private readonly repositoryDeletion: RepositoryDeletionRepository,
  ) {}

  findContext(
    programId: string,
    studentId: string,
  ): Promise<StudentRepositoryUrlContext | null> {
    return this.prisma.application.findFirst({
      where: {
        programId,
        ...this.platformRepository.programApplicationParticipantWhere(
          studentId,
        ),
      },
      select:
        this.studentRepositoryUrlContextRepository
          .STUDENT_REPOSITORY_URL_SELECT,
    });
  }

  findTeamContext(
    programId: string,
    teamId: string,
    actorGithubId: bigint,
  ): Promise<TeamRepositoryUrlContext | null> {
    return this.studentRepositoryUrlContextRepository.readTeamRepositoryUrlContext(
      this.prisma,
      programId,
      teamId,
      actorGithubId,
    );
  }

  withTransaction<T>(
    operation: (store: StudentRepositoryUrlTransactionRepository) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(
        new StudentRepositoryUrlTransactionRepository(
          transaction,
          this.repositoryProvisionGenerationRepository,
          this.studentRepositoryUrlContextRepository,
          this.repositoryDeletion,
        ),
      ),
    );
  }
}

import { repositoryUrlError } from './applications-error-code.error';
