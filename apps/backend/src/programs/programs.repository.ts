import { Injectable } from '@nestjs/common';
import type { Program } from '@prisma/client';
import {
  ApplicationStatus,
  Prisma,
  ProgramCategory,
  RoleRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import type {
  ProgramListQuery,
  ProgramListQueryStatus,
} from './program-list-query';
import { programApplicationParticipantWhere } from './program-participant';

export type ProgramListRecord = Pick<
  Program,
  | 'id'
  | 'name'
  | 'organizer'
  | 'category'
  | 'applicationStartAt'
  | 'applicationEndAt'
  | 'description'
>;

function recruitmentWhere(
  status: ProgramListQueryStatus,
  now: Date,
): Prisma.ProgramWhereInput {
  const whereByStatus = {
    all: {},
    recruiting: {
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
    },
    closed: { applicationEndAt: { lt: now } },
  } satisfies Readonly<
    Record<ProgramListQueryStatus, Prisma.ProgramWhereInput>
  >;
  return whereByStatus[status];
}

function programListSqlWhere(
  status: ProgramListQueryStatus,
  search: string,
  now: Date,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (status === 'recruiting') {
    conditions.push(
      Prisma.sql`p."applicationStartAt" <= ${now} AND p."applicationEndAt" >= ${now}`,
    );
  } else if (status === 'closed') {
    conditions.push(Prisma.sql`p."applicationEndAt" < ${now}`);
  }
  if (search) {
    conditions.push(Prisma.sql`p."name" ILIKE ${`%${search}%`}`);
  }
  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

@Injectable()
export class ProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listPrograms(query: ProgramListQuery, now: Date) {
    const where: Prisma.ProgramWhereInput = {
      ...recruitmentWhere(query.status, now),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const sqlWhere = programListSqlWhere(query.status, query.search, now);
    const offset = (query.page - 1) * query.pageSize;
    return this.prisma.$transaction([
      this.prisma.$queryRaw<readonly ProgramListRecord[]>(Prisma.sql`
        SELECT
          p."id",
          p."name",
          p."organizer",
          p."category",
          p."applicationStartAt",
          p."applicationEndAt",
          p."description"
        FROM "Program" AS p
        ${sqlWhere}
        ORDER BY
          CASE
            WHEN p."applicationStartAt" <= ${now}
              AND p."applicationEndAt" >= ${now} THEN 0
            WHEN p."applicationStartAt" > ${now} THEN 1
            ELSE 2
          END ASC,
          p."applicationEndAt" ASC,
          p."name" ASC,
          p."id" ASC
        LIMIT ${query.pageSize}
        OFFSET ${offset}
      `),
      this.prisma.program.count({ where }),
    ]);
  }

  findProgramDetail(programId: string) {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        name: true,
        organizer: true,
        category: true,
        description: true,
        applicationStartAt: true,
        applicationEndAt: true,
        milestones: {
          orderBy: [{ dueAt: 'asc' as const }, { createdAt: 'asc' as const }],
          select: {
            id: true,
            name: true,
            dueAt: true,
            instructions: true,
            submissionType: true,
          },
        },
      },
    });
  }

  findStudentApplication(programId: string, userId: string) {
    return this.prisma.application.findFirst({
      where: {
        programId,
        ...programApplicationParticipantWhere(userId),
      },
      select: {
        id: true,
        status: true,
        submissions: { select: { milestoneId: true, status: true } },
      },
    });
  }

  findApprovedApplications(programId: string) {
    return this.prisma.application.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      select: {
        submissions: { select: { milestoneId: true, status: true } },
      },
    });
  }

  async findProgramRepositories(
    programId: string,
    studentUserId: string | null,
  ) {
    const repositories = await this.prisma.repository.findMany({
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
                ...COMPATIBLE_PROFILE_NAME_SELECT,
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
    return repositories.map((repository) => ({
      githubRepositoryId: repository.githubRepositoryId,
      application: {
        id: repository.application.id,
        applicant: {
          githubId: repository.application.applicant.githubId,
          nickname: repository.application.applicant.nickname,
          name: resolveCompatibleProfileName(repository.application.applicant),
        },
        team: repository.application.team,
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
        role: true,
        roleRequests: {
          where: { status: RoleRequestStatus.PENDING },
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  findCreatorRole(githubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true, accountStatus: true },
    });
  }

  createProgram(data: {
    readonly name: string;
    readonly organizer: string;
    readonly category: ProgramCategory;
    readonly applicationTemplateKey: string;
    readonly applicationTemplateVersion: number;
    readonly applicationStartAt: Date;
    readonly applicationEndAt: Date;
    readonly endAt: Date;
    readonly teamMinSize: number | null;
    readonly teamMaxSize: number | null;
    readonly description: string;
  }) {
    return this.prisma.program.create({ data });
  }
}
