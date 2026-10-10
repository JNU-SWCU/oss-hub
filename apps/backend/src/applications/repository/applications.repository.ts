import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  RepositoryConnectionMode,
  RepositoryIssuanceOutcome,
  RepositoryProvisionJobStatus,
  type RepositorySource,
  type RepositoryVisibility,
  ProgramLifecycle,
  type ProgramCategory,
} from '@prisma/client';
import type {
  OutboxEvent as PrismaOutboxEvent,
  Prisma as PrismaTypes,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../prisma/audit-log-transaction-writer';
import { PrismaService } from '../../prisma/prisma.service';
import { repositoryUrlFromNameWithOwner } from '../../github/domain/repository-identity';
import { parseRepositoryProvisionEvent } from '../../github/domain/repository-provision-event';
import {
  transferProvisionGeneration,
  writeRepositoryIssuanceHistory,
} from '../../prisma/repository-provision-generation';
import {
  userProfileNameWhere,
  STUDENT_MEMBER_WHERE,
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../../prisma/user-profile-read';
import type { ApplicationListQuery } from '../domain/application-list-query';
import type {
  ApplicationDecisionTarget,
  ApplicationDecisionNotificationInput,
  ApplicationTransition,
  RepositoryProvisionEvent,
  RepositoryProvisionEventInput,
  RepositoryProvisionJobSnapshot,
} from '../domain/application-decision';
import type {
  CreatedApplication,
  ApplicationListAnswers,
  ApplicationListItem,
  ApplicationListPage,
  ApplicationRepositoryProvisioning,
  ApplicationReviewHistoryEntry,
  RepositoryProvisioningJobStatus,
  RepositoryProvisioningSafeErrorClass,
  StaffDashboardApplicationCounts,
  StaffDashboardSummary,
  TeamManagementListItem,
  TeamManagementListPage,
} from '../domain/application-records';
import { appendReviewHistory } from './review-history.writer';
import type {
  AppendReviewHistoryInput,
  AppendedReviewHistory,
} from './review-history.writer';

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
  | 'application'
  | 'applicationReviewHistory'
  | 'auditLog'
  | '$queryRaw'
>;

type LockedProgramRow = Readonly<{ lifecycle: ProgramLifecycle }>;
type LockedTeamRow = Readonly<{ id: string; leaderId: string }>;

export interface ApplicationsTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;

  appendReviewHistory(
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory>;
  findApplicationById(
    applicationId: string,
  ): Promise<ApplicationDecisionTarget | null>;
  findRepositoryProvisionJob(
    applicationId: string,
  ): Promise<RepositoryProvisionJobSnapshot | null>;
  findRepositoryProvisionEvent(
    idempotencyKey: string,
  ): Promise<RepositoryProvisionEvent | null>;

  discardRepositoryProvisionRequest(
    applicationId: string,
    discardedAt: Date,
  ): Promise<void>;
  transitionApplication(input: ApplicationTransition): Promise<boolean>;
  createApplicationDecisionNotifications(
    input: ApplicationDecisionNotificationInput,
  ): Promise<void>;
  createRepositoryProvisionEvent(
    input: RepositoryProvisionEventInput,
  ): Promise<RepositoryProvisionEvent>;
}

export class RepositoryEventAlreadyExistsError extends Error {
  override readonly name = 'RepositoryEventAlreadyExistsError';
}

export class ApplicationDuplicateError extends Error {
  override readonly name = 'ApplicationDuplicateError';
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

export interface CreateTeamForApplicationInput {
  readonly programId: string;
  readonly name: string;
  readonly joinCodeDigest: string;
  readonly leaderId: string;
}

export interface CreatedTeamForApplication {
  readonly id: string;
  readonly name: string;
}

export interface CreateApplicationRecordInput {
  readonly programId: string;
  readonly applicantId: string;
  readonly teamId: string;
  readonly answers: Prisma.InputJsonValue;
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
}

export class ApplicationTeamMembershipConflictError extends Error {
  override readonly name = 'ApplicationTeamMembershipConflictError';
}

export class ApplicationJoinCodeDigestConflictError extends Error {
  override readonly name = 'ApplicationJoinCodeDigestConflictError';
}

export interface ApplicationCreateStore {
  readonly auditLogWriter: AuditLogTransactionWriter;

  appendReviewHistory(
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory>;
  lockProgramForApply(programId: string): Promise<ProgramLifecycle | null>;
  findTeamMinSize(programId: string): Promise<number | null>;

  findExistingTeamMembership(
    programId: string,
    userId: string,
  ): Promise<CreatedTeamForApplication | null>;

  lockTeamForApply(teamId: string, userId: string): Promise<boolean>;

  countTeamMembers(teamId: string): Promise<number>;
  createTeamWithLeader(
    input: CreateTeamForApplicationInput,
  ): Promise<CreatedTeamForApplication>;
  createApplication(
    input: CreateApplicationRecordInput,
  ): Promise<CreatedApplication>;
}

class PrismaApplicationsTransactionStore implements ApplicationsTransactionStore {
  constructor(private readonly transaction: PrismaTypes.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  appendReviewHistory(
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory> {
    return appendReviewHistory(this.transaction, input);
  }

  async findApplicationById(
    applicationId: string,
  ): Promise<ApplicationDecisionTarget | null> {
    const application = await this.transaction.application.findUnique({
      where: { id: applicationId },
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

  async findRepositoryProvisionJob(
    applicationId: string,
  ): Promise<RepositoryProvisionJobSnapshot | null> {
    const job = await this.transaction.repositoryProvisionJob.findUnique({
      where: { applicationId },
      select: { status: true, repositoryId: true },
    });
    return job;
  }

  async findRepositoryProvisionEvent(
    idempotencyKey: string,
  ): Promise<RepositoryProvisionEvent | null> {
    const event = await this.transaction.outboxEvent.findUnique({
      where: { idempotencyKey },
    });
    return event ? toRepositoryProvisionEvent(event) : null;
  }

  async discardRepositoryProvisionRequest(
    applicationId: string,
    discardedAt: Date,
  ): Promise<void> {
    const job = (
      await this.transaction.$queryRaw<
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
    const event = await this.transaction.outboxEvent.findUnique({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
      select: { id: true },
    });
    if (event !== null) {
      const ownsJob = job?.currentEventId === event.id;
      await writeRepositoryIssuanceHistory(
        this.transaction,
        {
          requestId: event.id,
          applicationId,
          repositoryId: ownsJob ? job.repositoryId : null,
          source: ownsJob ? job.repositorySource : null,
          outcome: RepositoryIssuanceOutcome.DISCARDED,
          closedAt: discardedAt,
        },
        parseRepositoryProvisionEvent,
      );
    }

    await this.transaction.outboxEvent.deleteMany({
      where: { idempotencyKey: `repository-provision:${applicationId}` },
    });
    await this.transaction.repositoryProvisionJob.deleteMany({
      where: { applicationId },
    });
  }

  async transitionApplication(input: ApplicationTransition): Promise<boolean> {
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
    const result = await this.transaction.application.updateMany({
      where: {
        id: input.applicationId,
        status: input.expectedStatus,
      },
      data,
    });
    return result.count === 1;
  }

  async createApplicationDecisionNotifications(
    input: ApplicationDecisionNotificationInput,
  ): Promise<void> {
    if (input.recipientUserIds.length === 0) return;
    const decidedAt = input.decidedAt.toISOString();
    await this.transaction.notification.createMany({
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

  async createRepositoryProvisionEvent(
    input: RepositoryProvisionEventInput,
  ): Promise<RepositoryProvisionEvent> {
    try {
      const event = await this.transaction.outboxEvent.create({
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
      await transferProvisionGeneration(
        this.transaction,
        {
          applicationId: input.applicationId,
          newEventId: event.id,
          now: input.requestedAt,
        },
        parseRepositoryProvisionEvent,
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
}

class PrismaApplicationCreateStore implements ApplicationCreateStore {
  constructor(private readonly database: ApplicationDatabase) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.database;
  }

  appendReviewHistory(
    input: AppendReviewHistoryInput,
  ): Promise<AppendedReviewHistory> {
    return appendReviewHistory(this.database, input);
  }

  async lockProgramForApply(
    programId: string,
  ): Promise<ProgramLifecycle | null> {
    const rows = await this.database.$queryRaw<readonly LockedProgramRow[]>(
      Prisma.sql`SELECT "lifecycle" FROM "Program" WHERE id = ${programId} FOR UPDATE`,
    );
    return rows[0]?.lifecycle ?? null;
  }

  async findTeamMinSize(programId: string): Promise<number | null> {
    const program = await this.database.program.findUnique({
      where: { id: programId },
      select: { teamMinSize: true },
    });
    return program?.teamMinSize ?? null;
  }

  async findExistingTeamMembership(
    programId: string,
    userId: string,
  ): Promise<CreatedTeamForApplication | null> {
    const membership = await this.database.teamMember.findUnique({
      where: { programId_userId: { programId, userId } },
      select: { team: { select: { id: true, name: true } } },
    });
    return membership?.team ?? null;
  }

  async countTeamMembers(teamId: string): Promise<number> {
    return this.database.teamMember.count({ where: { teamId } });
  }

  async lockTeamForApply(teamId: string, userId: string): Promise<boolean> {
    const rows = await this.database.$queryRaw<readonly LockedTeamRow[]>(
      Prisma.sql`SELECT "id", "leaderId" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`,
    );
    const locked = rows[0];
    if (!locked || locked.leaderId !== userId) {
      return false;
    }

    const membership = await this.database.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { id: true },
    });
    return membership !== null;
  }

  async createTeamWithLeader(
    input: CreateTeamForApplicationInput,
  ): Promise<CreatedTeamForApplication> {
    try {
      const team = await this.database.team.create({
        data: {
          programId: input.programId,
          name: input.name,
          joinCodeDigest: input.joinCodeDigest,
          leaderId: input.leaderId,
        },
        select: { id: true, name: true },
      });
      await this.database.teamMember.create({
        data: {
          teamId: team.id,
          programId: input.programId,
          userId: input.leaderId,
        },
      });
      return team;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target;
        const fields = Array.isArray(target)
          ? target.map(String)
          : typeof target === 'string'
            ? [target]
            : [];
        if (fields.some((field) => field.includes('joinCodeDigest'))) {
          throw new ApplicationJoinCodeDigestConflictError();
        }
        throw new ApplicationTeamMembershipConflictError();
      }
      throw error;
    }
  }

  async createApplication(
    input: CreateApplicationRecordInput,
  ): Promise<CreatedApplication> {
    try {
      return await this.database.application.create({
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

@Injectable()
export class ApplicationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: ApplicationsTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaApplicationsTransactionStore(transaction)),
    );
  }

  async withCreateTransaction<T>(
    operation: (store: ApplicationCreateStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaApplicationCreateStore(transaction)),
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
          name: resolveUserProfileName(user),
        }
      : null;
  }

  findProgramById(programId: string): Promise<ApplyProgramRecord | null> {
    return this.prisma.program.findUnique({
      where: { id: programId },
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
  ): Promise<ApplicationListPage> {
    const where = buildApplicationListWhere(programId, query);
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
      items: rows.map((row) =>
        toApplicationListItem(
          row,
          outboxByApplicationId.get(row.id),
          jobByApplicationId.get(row.id),
        ),
      ),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async findApplicationForStaff(
    applicationId: string,
  ): Promise<ApplicationListItem | null> {
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
    return toApplicationListItem(row, outbox ?? undefined, job ?? undefined);
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
        name: resolveUserProfileName(row.actor),
        nickname: row.actor.nickname,
      },
    }));
  }

  async listTeamManagementForProgram(
    programId: string,
    query: ApplicationListQuery,
  ): Promise<TeamManagementListPage> {
    const where = buildTeamManagementListWhere(programId, query);

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
}

function buildApplicationListWhere(
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
            applicant: userProfileNameWhere(search),
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
  programId: string,
  query: ApplicationListQuery,
): Prisma.ApplicationWhereInput {
  const base = buildApplicationListWhere(programId, query);
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
                { user: userProfileNameWhere(query.search) },
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
] as const satisfies Prisma.ApplicationOrderByWithRelationInput[];

const TEAM_MANAGEMENT_LIST_SELECT = {
  id: true,
  programId: true,
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
} as const satisfies Prisma.ApplicationSelect;

type TeamManagementListRow = Prisma.ApplicationGetPayload<{
  readonly select: typeof TEAM_MANAGEMENT_LIST_SELECT;
}>;

function toTeamManagementListItem(
  row: TeamManagementListRow,
): TeamManagementListItem {
  return {
    id: row.id,
    programId: row.programId,
    status: row.status,
    submittedAt: row.submittedAt,
    rejectionReason: row.rejectionReason,
    applicant: {
      id: row.applicant.id,
      name: resolveUserProfileName(row.applicant),
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
              name: resolveUserProfileName(member.user),
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
} as const satisfies Prisma.ApplicationSelect;

type ApplicationListRow = {
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
    readonly profile: { readonly name: string } | null;
  };
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly _count: { readonly members: number };
  } | null;
};

type ApplicationListOutbox = {
  readonly status: OutboxEventStatus;
  readonly createdAt: Date;
};

type ApplicationListProvisionJob = {
  readonly repositoryId: string | null;
  readonly status: RepositoryProvisionJobStatus;
  readonly updatedAt: Date;
  readonly lastErrorCode: string | null;
};

function toApplicationListItem(
  row: ApplicationListRow,
  outbox: ApplicationListOutbox | undefined,
  job: ApplicationListProvisionJob | undefined,
): ApplicationListItem {
  const team =
    row.team !== null
      ? {
          id: row.team.id,
          name: row.team.name,
          memberCount: row.team._count.members,
        }
      : null;
  return {
    id: row.id,
    programId: row.programId,
    status: row.status,
    submittedAt: row.submittedAt,
    rejectionReason: row.rejectionReason,
    repositoryConnectionMode: row.repositoryConnectionMode,
    repositoryUrl: row.repositoryUrl,
    repositoryProvisioning:
      row.status === ApplicationStatus.APPROVED &&
      row.repository != null &&
      job?.status === RepositoryProvisionJobStatus.SUCCEEDED &&
      job.repositoryId === row.repository.id &&
      row.repositoryUrl ===
        repositoryUrlFromNameWithOwner(row.repository.nameWithOwner)
        ? {
            enabled: row.program.repositoryProvisioningEnabled,
            jobStatus: 'SUCCEEDED',
            updatedAt: job.updatedAt,
            safeErrorClass: null,
          }
        : resolveRepositoryProvisioning(
            row.status,
            row.program.repositoryProvisioningEnabled,
            row.updatedAt,
            outbox,
            job,
          ),
    repository: row.repository
      ? {
          url: repositoryUrlFromNameWithOwner(row.repository.nameWithOwner),
          visibility: row.repository.visibility,
        }
      : null,
    isRepositoryPublicationPlanned: row.isRepositoryPublicationPlanned,
    participation: team ? 'TEAM' : 'INDIVIDUAL',
    applicant: {
      id: row.applicant.id,
      nickname: row.applicant.nickname,
      name: resolveUserProfileName(row.applicant),
    },
    team,
    answers: parseListAnswers(row.answers),
  };
}
function resolveRepositoryProvisioning(
  applicationStatus: ApplicationStatus,
  enabled: boolean,
  applicationUpdatedAt: Date,
  outbox: ApplicationListOutbox | undefined,
  job: ApplicationListProvisionJob | undefined,
): ApplicationRepositoryProvisioning {
  const anomalous = (): ApplicationRepositoryProvisioning => ({
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
    const jobStatus = mapProvisionJobStatus(job.status);
    return {
      enabled,
      jobStatus,
      updatedAt: job.updatedAt,
      safeErrorClass:
        jobStatus === 'RETRYABLE_FAILED' || jobStatus === 'FAILED'
          ? normalizeSafeErrorClass(job.lastErrorCode)
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

function mapProvisionJobStatus(
  status: RepositoryProvisionJobStatus,
): RepositoryProvisioningJobStatus {
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

function normalizeSafeErrorClass(
  errorCode: string | null,
): RepositoryProvisioningSafeErrorClass {
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

function parseListAnswers(value: Prisma.JsonValue): ApplicationListAnswers {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { applicantName: '', title: '', summary: '' };
  }
  const record = value as Record<string, unknown>;
  return {
    applicantName:
      typeof record.applicantName === 'string' ? record.applicantName : '',
    title: typeof record.title === 'string' ? record.title : '',
    summary: typeof record.summary === 'string' ? record.summary : '',
  };
}

function toApplicationDecisionTarget(
  application: ApplicationWithProgram,
): ApplicationDecisionTarget {
  const githubLogins = application.team
    ? [
        application.team.leader.nickname,
        ...application.team.members.map((member) => member.user.nickname),
      ]
    : [application.applicant.nickname];
  return {
    id: application.id,
    programId: application.programId,
    programName: application.program.name,

    applicantGithubLogin: application.applicant.nickname,
    teamId: application.teamId,
    status: application.status,
    repositoryProvisioningEnabled:
      application.program.repositoryProvisioningEnabled,
    collaboratorGithubLogins: [
      ...new Set(githubLogins.map((login) => login.toLowerCase())),
    ].sort(),
    notificationRecipientIds: [
      ...new Set(
        application.team
          ? [
              application.team.leader.id,
              ...application.team.members.map((member) => member.user.id),
            ]
          : [application.applicant.id],
      ),
    ].sort(),
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
