import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  OutboxEventStatus,
  Prisma,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  type RepositoryVisibility,
  Role,
  ProgramLifecycle,
  type ProgramCategory,
} from '@prisma/client';
import type {
  OutboxEvent as PrismaOutboxEvent,
  Prisma as PrismaTypes,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import {
  computeJoinCodeDigest,
  resolveJoinCodeSecretFromConfig,
} from '../common/join-code-digest';
import { PrismaService } from '../prisma/prisma.service';
import { repositoryUrlFromNameWithOwner } from '../github/repository-identity';
import {
  compatibleProfileNameWhere,
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import type { ApplicationListQuery } from './application-list-query';
import type {
  ApplicationDecisionTarget,
  ApplicationDecisionNotificationInput,
  ApplicationTransition,
  RepositoryProvisionEvent,
  RepositoryProvisionEventInput,
  RepositoryProvisionJobSnapshot,
} from './domain/application-decision';

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
  | 'auditLog'
  | '$queryRaw'
>;

type LockedProgramRow = Readonly<{ lifecycle: ProgramLifecycle }>;
type LockedTeamRow = Readonly<{ id: string }>;

export interface ApplicationsTransactionStore {
  /** #547 — 판정 전이와 감사 기록이 같은 트랜잭션에서 함께 커밋되도록 하는 writer. */
  readonly auditLogWriter: AuditLogTransactionWriter;
  findApplicationById(
    applicationId: string,
  ): Promise<ApplicationDecisionTarget | null>;
  findRepositoryProvisionJob(
    applicationId: string,
  ): Promise<RepositoryProvisionJobSnapshot | null>;
  findRepositoryProvisionEvent(
    idempotencyKey: string,
  ): Promise<RepositoryProvisionEvent | null>;
  /**
   * 되돌리기 시 진행 중이던 프로비저닝 요청을 지운다 — outbox 이벤트와 job 양쪽.
   * 남겨 두면 재승인이 기존 이벤트를 재사용해 새 job을 만들지 않아 저장소가
   * 영영 만들어지지 않는다. 완료된 건은 상위 가드가 이미 409로 막는다.
   */
  discardRepositoryProvisionRequest(applicationId: string): Promise<void>;
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

/**
 * 신청자 목록의 저장소 주소 — 교직원 화면이 「공개 저장소 열기」/「비공개 저장소 확인」을
 * 가르는 데 쓴다. 출처는 `Application.repository` 1:1 관계다. `Team.repositories` 로 가지
 * 않는다 — 저장소 식별 단위는 application 이다(`schema.prisma` Repository 주석, #113).
 * 아직 프로비저닝되지 않았으면 null.
 */
export interface ApplicationListRepository {
  readonly url: string;
  readonly visibility: RepositoryVisibility;
}

export interface ApplicationListItem {
  readonly id: string;
  /**
   * 어느 프로그램의 신청인가. 상세 화면이 주소의 프로그램과 대조하는 데 쓴다 —
   * `GET applications/:id`는 신청 id 하나로 도달하므로, 주소를 손으로 고치면
   * 프로그램 A의 화면에서 프로그램 B의 신청을 판정하게 된다.
   */
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly submittedAt: Date;
  readonly rejectionReason: string | null;
  readonly repositoryProvisioning: ApplicationRepositoryProvisioning;
  /** 승인 시 저장소를 새로 만드는가(`NEW`), 낸 저장소를 잇는가(`OWN`). */
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  /** `OWN`일 때 이을 저장소 주소. `NEW`면 null. */
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

export class ApplicationTeamMembershipConflictError extends Error {
  override readonly name = 'ApplicationTeamMembershipConflictError';
}

export class ApplicationJoinCodeDigestConflictError extends Error {
  override readonly name = 'ApplicationJoinCodeDigestConflictError';
}

export interface ApplicationCreateStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  lockProgramForApply(programId: string): Promise<ProgramLifecycle | null>;
  findTeamMinSize(programId: string): Promise<number | null>;
  /**
   * 이 프로그램에서 학생이 이미 속한 팀 — 있으면 신청이 그 팀을 재사용한다.
   * `TeamMember @@unique([programId, userId])` 때문에 많아야 하나다.
   */
  findExistingTeamMembership(
    programId: string,
    userId: string,
  ): Promise<CreatedTeamForApplication | null>;
  /** 팀 구성 변경과 신청 생성을 직렬화한다. 잠금 순서는 Program → Team이다. */
  lockTeamForApply(teamId: string): Promise<void>;
  /** 재사용할 팀의 최소 인원 검증용. */
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
  ): Promise<void> {
    // outbox를 먼저 지운다 — 컨슈머가 아직 이벤트를 집지 않았다면 job 자체가 생기지
    // 않는다. 이미 집은 뒤라면 아래 job 삭제가 정리하고, 그 사이에 컨슈머가 넣은
    // 고아 job은 다음 승인이 같은 경로로 다시 지운다.
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

  async lockTeamForApply(teamId: string): Promise<void> {
    await this.database.$queryRaw<readonly LockedTeamRow[]>(
      Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`,
    );
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
  private readonly joinCodeSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RUNTIME_CONFIG)
    runtimeConfig: Pick<RuntimeConfig, 'TEAM_JOIN_CODE_SECRET'>,
  ) {
    this.joinCodeSecret = resolveJoinCodeSecretFromConfig(runtimeConfig);
  }

  /** program-teams.service.ts generateJoinCode 와 동일 규칙. 그 함수는 비export. */
  generateJoinCode(): string {
    return randomBytes(6).toString('base64url').toUpperCase().slice(0, 10);
  }

  computeJoinCodeDigest(joinCode: string): string {
    return computeJoinCodeDigest(joinCode, this.joinCodeSecret);
  }

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

  /**
   * 교직원 신청 상세(#722). 목록과 같은 `RepeatableRead` 트랜잭션 안에서 신청·outbox·
   * provision job 을 함께 읽는다 — 셋을 따로 읽으면 그 사이에 판정이 끼어들어 「반려인데
   * 저장소 작업이 진행 중」 같은 있을 수 없는 조합이 화면에 그려진다.
   */
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
            select: { status: true, updatedAt: true, lastErrorCode: true },
          }),
        ]);
        return [applicationRow, event, provisionJob] as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (row === null) return null;
    return toApplicationListItem(row, outbox ?? undefined, job ?? undefined);
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
          applicantsPath: `/programs/${encodeURIComponent(program.id)}/applicants`,
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
    ...statusWhere,
    ...searchWhere,
  };
}

/**
 * 목록과 단건 조회가 **같은 select**를 쓴다. 화면이 둘이라도 교직원이 보는 신청 한 건의
 * 모양은 하나여야 한다 — 한쪽만 필드를 늘리면 목록에서 보이던 값이 상세에서 사라진다.
 */
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
  // 승인이 무엇을 하는지는 프로그램의 자동 생성 스위치 하나로 정해지지 않는다 —
  // 신청자가 `OWN`을 골랐으면 새로 만드는 게 아니라 낸 저장소를 잇는다.
  repositoryConnectionMode: true,
  repositoryUrl: true,
  // 1:1 Application.repository — 팀의 repositories 로 가지 않는다(#113).
  // GithubRepository는 name/url 컬럼을 두지 않는다(#617 단계 D) — nameWithOwner에서
  // repository-identity.ts 헬퍼로 url을 유도한다.
  repository: {
    select: { nameWithOwner: true, visibility: true },
  },
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
    readonly nameWithOwner: string;
    readonly visibility: RepositoryVisibility;
  } | null;
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
    repositoryProvisioning: resolveRepositoryProvisioning(
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
    programName: application.program.name,
    // applicant는 이미 위 include에서 select된 값이다(팀 신청 라벨 계산에도 쓰인다) —
    // 추가 쿼리 없이 감사 로그 스냅샷에 그대로 흘려보낸다.
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
