import { Injectable } from '@nestjs/common';
import {
  type Program,
  ApplicationStatus,
  MilestoneDocumentKind,
  Prisma,
  ProgramCategory,
  StaffAccessRequestStatus,
  type ProgramTrackType,
  type ProgramLifecycle,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../platform/user-profile-read.config';
import {
  ProgramListStatusFilterRepository,
  type ProgramListQuery,
} from './program-list-status-filter.repository';
import { programApplicationParticipantWhere } from '../platform/program-application-participant.config';
import {
  submissionCompletionTargetSelect,
  type SubmissionCompletionTargetRow,
  projectSubmissionCompletionTargets,
} from './submission-completion.config';

export type ProgramListRecord = {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationTemplateKey: string;
  readonly lifecycle: ProgramLifecycle;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly endAt: Date;
  readonly description: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly coverId?: string | null;
  readonly coverExternalImageUrl?: string | null;
};

export type ProgramStatusCounts = {
  readonly all: number;
  readonly recruiting: number;
  readonly in_progress: number;
  readonly upcoming: number;
  readonly ended: number;
};

function emptyProgramStatusCounts(): ProgramStatusCounts {
  return {
    all: 0,
    recruiting: 0,
    in_progress: 0,
    upcoming: 0,
    ended: 0,
  };
}

export interface ProgramApplicationCounts {
  readonly total: number;
  readonly pending: number;
}

@Injectable()
export class ProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listPrograms(query: ProgramListQuery, now: Date) {
    const where: Prisma.ProgramWhereInput = {
      ...ProgramListStatusFilterRepository.programListPrismaWhere(
        query.status,
        now,
      ),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.year !== undefined
        ? {
            AND: [
              {
                endAt: ProgramListStatusFilterRepository.programEndYearRange(
                  query.year,
                ),
              },
            ],
          }
        : {}),
    };
    const sqlWhere = ProgramListStatusFilterRepository.programListSqlWhere(
      query.status,
      query.search,
      now,
      query.year,
    );
    const orderBy = ProgramListStatusFilterRepository.programListOrderBySql(
      query.sort,
      query.direction,
      now,
    );
    const offset = (query.page - 1) * query.pageSize;
    return this.prisma.$transaction([
      this.prisma.$queryRaw<readonly ProgramListRecord[]>(Prisma.sql`
        SELECT
          p."id",
          p."name",
          p."organizer",
          p."trackType",
          p."applicationTemplateKey",
          p."lifecycle",
          p."applicationStartAt",
          p."applicationEndAt",
          p."endAt",
          p."description",
          p."teamMinSize",
          p."teamMaxSize",
          cover."id" AS "coverId",
          cover."imageUrl" AS "coverExternalImageUrl"
        FROM "Program" AS p
        LEFT JOIN "ProgramCover" AS cover ON cover."programId" = p."id"
        ${sqlWhere}
        ORDER BY ${orderBy}
        LIMIT ${query.pageSize}
        OFFSET ${offset}
      `),
      this.prisma.program.count({ where }),
    ]);
  }

  async findEndedYears(now: Date): Promise<readonly number[]> {
    const programEndYearSql = Prisma.sql`EXTRACT(YEAR FROM p."endAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::int`;
    const rows = await this.prisma.$queryRaw<
      readonly { readonly year: number }[]
    >(Prisma.sql`
      SELECT DISTINCT ${programEndYearSql} AS year
      FROM "Program" AS p
      ${ProgramListStatusFilterRepository.programListSqlWhere('ended', '', now)}
      AND ${programEndYearSql} BETWEEN 2000 AND 2100
      ORDER BY year DESC
    `);
    return rows.map((row) => row.year);
  }

  async countProgramsByStatus(now: Date): Promise<ProgramStatusCounts> {
    const rows = await this.prisma.$queryRaw<
      readonly {
        readonly all: number;
        readonly recruiting: number;
        readonly in_progress: number;
        readonly upcoming: number;
        readonly ended: number;
      }[]
    >(ProgramListStatusFilterRepository.programStatusCountsSql(now));
    const row = rows[0];
    if (!row) return emptyProgramStatusCounts();
    return {
      all: row.all,
      recruiting: row.recruiting,
      in_progress: row.in_progress,
      upcoming: row.upcoming,
      ended: row.ended,
    };
  }

  findProgramDetail(programId: string) {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        lifecycle: true,
        cover: { select: { id: true, imageUrl: true } },
        id: true,
        name: true,
        organizer: true,
        trackType: true,
        applicationTemplateKey: true,
        description: true,
        repositoryProvisioningEnabled: true,
        applicationStartAt: true,
        applicationEndAt: true,
        startAt: true,
        endAt: true,
        milestones: {
          orderBy: [{ dueAt: 'asc' as const }, { createdAt: 'asc' as const }],
          select: {
            id: true,
            name: true,
            startAt: true,
            dueAt: true,
            instructions: true,
            submissionType: true,
            _count: {
              select: {
                documents: {
                  where: { kind: MilestoneDocumentKind.DOCUMENT },
                },
              },
            },

            documents: {
              where: {
                required: true,
                kind: MilestoneDocumentKind.DOCUMENT,
              },
              select: { id: true },
            },
          },
        },
      },
    });
  }

  async findStudentApplication(programId: string, userId: string) {
    const application = await this.prisma.application.findFirst({
      where: {
        programId,
        ...programApplicationParticipantWhere(userId),
      },
      select: {
        id: true,
        status: true,
        milestoneDocumentSubmissions: {
          select: submissionCompletionTargetSelect,
        },
      },
    });
    return application ? toTargetSubmissionAxes(application) : null;
  }

  async findApprovedApplications(programId: string) {
    const applications = await this.prisma.application.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      select: {
        milestoneDocumentSubmissions: {
          select: submissionCompletionTargetSelect,
        },
      },
    });
    return applications.map(toTargetSubmissionAxes);
  }

  async findViewerApplicationStatuses(
    programIds: readonly string[],
    userId: string,
  ): Promise<ReadonlyMap<string, ApplicationStatus>> {
    if (programIds.length === 0) return new Map();
    const applications = await this.prisma.application.findMany({
      where: {
        programId: { in: [...programIds] },
        ...programApplicationParticipantWhere(userId),
      },
      select: { programId: true, status: true },
    });
    return new Map(
      applications.map((application) => [
        application.programId,
        application.status,
      ]),
    );
  }

  async countApplicationsByProgram(
    programIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProgramApplicationCounts>> {
    if (programIds.length === 0) return new Map();
    const rows = await this.prisma.application.groupBy({
      by: ['programId', 'status'],
      where: { programId: { in: [...programIds] } },
      _count: { _all: true },
    });
    const counts = new Map<string, { total: number; pending: number }>();
    for (const row of rows) {
      const bucket = counts.get(row.programId) ?? { total: 0, pending: 0 };
      bucket.total += row._count._all;
      if (row.status === ApplicationStatus.SUBMITTED) {
        bucket.pending += row._count._all;
      }
      counts.set(row.programId, bucket);
    }
    return counts;
  }

  async findProgramRepositories(
    programId: string,
    studentUserId: string | null,
  ) {
    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        programId,
        ...(studentUserId
          ? {
              application: {
                ...programApplicationParticipantWhere(studentUserId),
              },
            }
          : {}),
      },
      select: {
        githubRepositoryId: true,
        application: {
          select: {
            id: true,
            applicant: {
              select: {
                githubId: true,
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
            team: {
              select: {
                name: true,
                leader: { select: { githubId: true } },
                members: { select: { user: { select: { githubId: true } } } },
              },
            },
          },
        },
      },
    });

    return repositories
      .filter((repository) => repository.application !== null)
      .map((repository) => ({
        githubRepositoryId: repository.githubRepositoryId,
        application: {
          id: repository.application!.id,
          applicant: {
            githubId: repository.application!.applicant.githubId,
            nickname: repository.application!.applicant.nickname,
            name: resolveUserProfileName(repository.application!.applicant),
          },
          team: repository.application!.team,
        },
      }));
  }

  async findStudentActivityApplications(userId: string) {
    return this.prisma.application.findMany({
      where: {
        status: ApplicationStatus.APPROVED,
        ...programApplicationParticipantWhere(userId),
      },
      select: {
        teamId: true,
        applicant: { select: { githubId: true } },
        team: {
          select: {
            leader: { select: { githubId: true } },
            members: {
              select: { user: { select: { githubId: true } } },
            },
          },
        },
        program: {
          select: { id: true, name: true, applicationStartAt: true },
        },
        repository: { select: { githubRepositoryId: true } },
      },
    });
  }

  findViewer(githubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        accountStatus: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        profile: { select: { memberKind: true } },
        staffAccessRequests: {
          where: { status: StaffAccessRequestStatus.PENDING },
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  findCreatorRole(githubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
  }

  withCreateTransaction<T>(
    operation: (
      writer: Pick<Prisma.TransactionClient, 'program' | 'auditLog'>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) => operation(transaction));
  }

  createProgram(
    data: {
      readonly name: string;
      readonly organizer: string;
      readonly category: ProgramCategory;
      readonly trackType: Program['trackType'];
      readonly applicationTemplateKey: string;
      readonly applicationTemplateVersion: number;
      readonly applicationStartAt: Date;
      readonly applicationEndAt: Date;
      readonly startAt: Date;
      readonly endAt: Date;
      readonly teamMinSize: number;
      readonly teamMaxSize: number;
      readonly description: string;
    },
    writer: Pick<Prisma.TransactionClient, 'program'>,
  ) {
    return writer.program.create({ data });
  }
}

function toTargetSubmissionAxes<
  T extends {
    readonly milestoneDocumentSubmissions: readonly SubmissionCompletionTargetRow[];
  },
>(application: T) {
  const { submissions, documentSubmissions } =
    projectSubmissionCompletionTargets(
      application.milestoneDocumentSubmissions,
    );
  return {
    ...application,
    submissions,
    milestoneDocumentSubmissions: documentSubmissions,
  };
}
