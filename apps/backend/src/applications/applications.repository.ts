import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  RepositoryProvisionJobStatus,
  Role,
  type ProgramCategory,
} from '@prisma/client';
import type {
  OutboxEvent as PrismaOutboxEvent,
  Prisma as PrismaTypes,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  compatibleProfileNameWhere,
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import type { ApplicationListQuery } from './application-list-query';
import type {
  ApplicationDecisionTarget,
  ApplicationTransition,
  RepositoryProvisionEvent,
  RepositoryProvisionEventInput,
} from './domain/application-decision';

type ApplicationWithProgram = PrismaTypes.ApplicationGetPayload<{
  include: {
    program: { select: { repositoryProvisioningEnabled: true } };
    applicant: { select: { nickname: true } };
    team: {
      select: {
        leader: { select: { nickname: true } };
        members: { select: { user: { select: { nickname: true } } } };
      };
    };
  };
}>;

type ApplicationDatabase = Pick<
  PrismaTypes.TransactionClient,
  'user' | 'program' | 'team' | 'application' | '$queryRaw'
>;

type LockedProgramRow = Readonly<{ id: string }>;

export interface ApplicationsTransactionStore {
  findApplicationById(
    applicationId: string,
  ): Promise<ApplicationDecisionTarget | null>;
  transitionApplication(input: ApplicationTransition): Promise<boolean>;
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
  readonly category: ProgramCategory;
  readonly applicationTemplateVersion: number;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
}

export interface ApplyTeamRecord {
  readonly id: string;
  readonly programId: string;
  readonly leaderId: string;
  readonly isMember: boolean;
  readonly memberCount: number;
  readonly teamMinSize: number | null;
}

export interface CreateApplicationRecordInput {
  readonly programId: string;
  readonly applicantId: string;
  readonly teamId: string | null;
  readonly answers: Prisma.InputJsonValue;
  readonly applicationTemplateVersion: number;
  readonly isRepositoryPublicationPlanned: boolean;
}

export interface CreatedApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;
  readonly submittedAt: Date;
  readonly isRepositoryPublicationPlanned: boolean;
}

export interface ApplicationListAnswers {
  readonly applicantName: string;
  readonly title: string;
  readonly summary: string;
}

export type RepositoryProvisioningJobStatus =
  | 'NOT_REQUESTED'
  | 'DISABLED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'RETRYABLE_FAILED'
  | 'FAILED'
  | 'ANOMALOUS';

export type RepositoryProvisioningSafeErrorClass =
  'AUTH' | 'RATE_LIMIT' | 'UPSTREAM_REJECTED' | 'UNKNOWN';

export interface ApplicationRepositoryProvisioning {
  readonly enabled: boolean;
  readonly jobStatus: RepositoryProvisioningJobStatus;
  readonly updatedAt: Date;
  readonly safeErrorClass: RepositoryProvisioningSafeErrorClass | null;
}

export interface ApplicationListItem {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: Date;
  readonly rejectionReason: string | null;
  readonly repositoryProvisioning: ApplicationRepositoryProvisioning;
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

export interface ApplicationListPage {
  readonly items: readonly ApplicationListItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

/** #117 운영 대시보드 — Application 단위 집계(제출 매트릭스 아님). */
export interface StaffDashboardApplicationCounts {
  readonly total: number;
  readonly submitted: number;
  readonly approved: number;
  readonly rejected: number;
}

export interface StaffDashboardProgramSummary {
  readonly id: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly applicationPeriod: {
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly applications: StaffDashboardApplicationCounts;
  readonly applicantsPath: string;
}

export interface StaffDashboardSummary {
  readonly programs: readonly StaffDashboardProgramSummary[];
}

export interface ApplicationCreateStore {
  lockProgramForApply(programId: string): Promise<boolean>;
  findTeamForApply(
    teamId: string,
    programId: string,
    userId: string,
  ): Promise<ApplyTeamRecord | null>;
  findPersonalDuplicate(
    programId: string,
    applicantId: string,
  ): Promise<boolean>;
  findTeamDuplicate(programId: string, teamId: string): Promise<boolean>;
  createApplication(
    input: CreateApplicationRecordInput,
  ): Promise<CreatedApplication>;
}

class PrismaApplicationsTransactionStore implements ApplicationsTransactionStore {
  constructor(private readonly transaction: PrismaTypes.TransactionClient) {}

  async findApplicationById(
    applicationId: string,
  ): Promise<ApplicationDecisionTarget | null> {
    const application = await this.transaction.application.findUnique({
      where: { id: applicationId },
      include: {
        program: { select: { repositoryProvisioningEnabled: true } },
        applicant: { select: { nickname: true } },
        team: {
          select: {
            leader: { select: { nickname: true } },
            members: { select: { user: { select: { nickname: true } } } },
          },
        },
      },
    });
    return application ? toApplicationDecisionTarget(application) : null;
  }

  async transitionApplication(input: ApplicationTransition): Promise<boolean> {
    const result = await this.transaction.application.updateMany({
      where: {
        id: input.applicationId,
        status: input.expectedStatus,
      },
      data: {
        status: input.nextStatus,
        rejectionReason: input.rejectionReason,
        processedById: input.processedById,
        processedAt: input.processedAt,
      },
    });
    return result.count === 1;
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
          },
        },
      });
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

  async lockProgramForApply(programId: string): Promise<boolean> {
    const rows = await this.database.$queryRaw<readonly LockedProgramRow[]>(
      Prisma.sql`SELECT id FROM "Program" WHERE id = ${programId} FOR UPDATE`,
    );
    return rows.length === 1;
  }

  async findTeamForApply(
    teamId: string,
    programId: string,
    userId: string,
  ): Promise<ApplyTeamRecord | null> {
    const team = await this.database.team.findFirst({
      where: { id: teamId, programId },
      select: {
        id: true,
        programId: true,
        leaderId: true,
        program: { select: { teamMinSize: true } },
        _count: { select: { members: true } },
        members: {
          where: { userId },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!team) return null;
    return {
      id: team.id,
      programId: team.programId,
      leaderId: team.leaderId,
      isMember: team.leaderId === userId || team.members.length > 0,
      memberCount: team._count.members,
      teamMinSize: team.program.teamMinSize,
    };
  }

  async findPersonalDuplicate(
    programId: string,
    applicantId: string,
  ): Promise<boolean> {
    const existing = await this.database.application.findFirst({
      where: { programId, applicantId, teamId: null },
      select: { id: true },
    });
    return existing !== null;
  }

  async findTeamDuplicate(programId: string, teamId: string): Promise<boolean> {
    const existing = await this.database.application.findFirst({
      where: { programId, teamId },
      select: { id: true },
    });
    return existing !== null;
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
          status: ApplicationStatus.SUBMITTED,
        },
        select: {
          id: true,
          programId: true,
          status: true,
          teamId: true,
          submittedAt: true,
          isRepositoryPublicationPlanned: true,
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
        role: Role.STUDENT,
      },
      select: {
        id: true,
        nickname: true,
        ...COMPATIBLE_PROFILE_NAME_SELECT,
      },
    });
    return user
      ? {
          id: user.id,
          nickname: user.nickname,
          name: resolveCompatibleProfileName(user),
        }
      : null;
  }

  findProgramById(programId: string): Promise<ApplyProgramRecord | null> {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        category: true,
        applicationTemplateVersion: true,
        applicationStartAt: true,
        applicationEndAt: true,
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
              select: {
                id: true,
                status: true,
                submittedAt: true,
                updatedAt: true,
                rejectionReason: true,
                teamId: true,
                answers: true,
                isRepositoryPublicationPlanned: true,
                program: {
                  select: { repositoryProvisioningEnabled: true },
                },
                applicant: {
                  select: {
                    id: true,
                    nickname: true,
                    ...COMPATIBLE_PROFILE_NAME_SELECT,
                  },
                },
                team: {
                  select: {
                    id: true,
                    name: true,
                    _count: { select: { members: true } },
                  },
                },
              },
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

  async listStaffDashboardSummary(): Promise<StaffDashboardSummary> {
    const programs = await this.prisma.program.findMany({
      orderBy: [{ applicationStartAt: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        category: true,
        applicationStartAt: true,
        applicationEndAt: true,
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
          id: program.id,
          name: program.name,
          category: program.category,
          applicationPeriod: {
            startsAt: program.applicationStartAt,
            endsAt: program.applicationEndAt,
          },
          applications,
          applicantsPath: `/staff/programs/${encodeURIComponent(program.id)}/applicants`,
        };
      }),
    };
  }
}

function buildApplicationListWhere(
  programId: string,
  query: ApplicationListQuery,
): Prisma.ApplicationWhereInput {
  const modeWhere: Prisma.ApplicationWhereInput =
    query.mode === 'personal'
      ? { teamId: null }
      : query.mode === 'team'
        ? { teamId: { not: null } }
        : {};

  const statusWhere: Prisma.ApplicationWhereInput =
    query.status === 'all' ? {} : { status: query.status };

  const search = query.search;
  const searchWhere: Prisma.ApplicationWhereInput = search
    ? {
        OR: [
          {
            applicant: compatibleProfileNameWhere(search),
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
    ...modeWhere,
    ...statusWhere,
    ...searchWhere,
  };
}

type ApplicationListRow = {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly rejectionReason: string | null;
  readonly teamId: string | null;
  readonly answers: Prisma.JsonValue;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly program: {
    readonly repositoryProvisioningEnabled: boolean;
  };
  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
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
    row.teamId !== null && row.team !== null
      ? {
          id: row.team.id,
          name: row.team.name,
          memberCount: row.team._count.members,
        }
      : null;
  return {
    id: row.id,
    status: row.status,
    submittedAt: row.submittedAt,
    rejectionReason: row.rejectionReason,
    repositoryProvisioning: resolveRepositoryProvisioning(
      row.status,
      row.program.repositoryProvisioningEnabled,
      row.updatedAt,
      outbox,
      job,
    ),
    isRepositoryPublicationPlanned: row.isRepositoryPublicationPlanned,
    participation: team ? 'TEAM' : 'INDIVIDUAL',
    applicant: {
      id: row.applicant.id,
      nickname: row.applicant.nickname,
      name: resolveCompatibleProfileName(row.applicant),
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
    teamId: application.teamId,
    status: application.status,
    repositoryProvisioningEnabled:
      application.program.repositoryProvisioningEnabled,
    collaboratorGithubLogins: [
      ...new Set(githubLogins.map((login) => login.toLowerCase())),
    ].sort(),
  };
}

function toRepositoryProvisionEvent(
  event: PrismaOutboxEvent,
): RepositoryProvisionEvent {
  return { id: event.id };
}
