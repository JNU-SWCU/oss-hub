import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  Prisma,
  Role,
  type ProgramCategory,
} from '@prisma/client';
import type {
  OutboxEvent as PrismaOutboxEvent,
  Prisma as PrismaTypes,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  'user' | 'program' | 'team' | 'application'
>;

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
}

export interface CreateApplicationRecordInput {
  readonly programId: string;
  readonly applicantId: string;
  readonly teamId: string | null;
  readonly answers: Prisma.InputJsonValue;
  readonly applicationTemplateVersion: number;
}

export interface CreatedApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;
  readonly submittedAt: Date;
}

export interface ApplicationListAnswers {
  readonly applicantName: string;
  readonly title: string;
  readonly summary: string;
}

export interface ApplicationListItem {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: Date;
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

  async findTeamDuplicate(
    programId: string,
    teamId: string,
  ): Promise<boolean> {
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
          status: ApplicationStatus.SUBMITTED,
        },
        select: {
          id: true,
          programId: true,
          status: true,
          teamId: true,
          submittedAt: true,
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

  findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<ApplicationStudentActor | null> {
    return this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STUDENT,
      },
      select: { id: true, name: true, nickname: true },
    });
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
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          status: true,
          submittedAt: true,
          teamId: true,
          answers: true,
          applicant: {
            select: { id: true, name: true, nickname: true },
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
      this.prisma.application.count({ where }),
    ]);

    return {
      items: rows.map((row) => toApplicationListItem(row)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async listStaffDashboardSummary(): Promise<StaffDashboardSummary> {
    const programs = await this.prisma.program.findMany({
      orderBy: [
        { applicationStartAt: 'desc' },
        { name: 'asc' },
        { id: 'asc' },
      ],
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
            applicant: {
              name: { contains: search, mode: 'insensitive' },
            },
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
  readonly teamId: string | null;
  readonly answers: Prisma.JsonValue;
  readonly applicant: {
    readonly id: string;
    readonly name: string | null;
    readonly nickname: string;
  };
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly _count: { readonly members: number };
  } | null;
};

function toApplicationListItem(row: ApplicationListRow): ApplicationListItem {
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
    participation: team ? 'TEAM' : 'INDIVIDUAL',
    applicant: row.applicant,
    team,
    answers: parseListAnswers(row.answers),
  };
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
