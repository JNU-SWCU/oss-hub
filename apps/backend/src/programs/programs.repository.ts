import { Injectable } from '@nestjs/common';
import type { Program } from '@prisma/client';
import {
  ApplicationStatus,
  Prisma,
  ProgramCategory,
  ProgramLifecycle,
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
  | 'endAt'
  | 'description'
>;

/**
 * 공개 목록 상태 필터 — 상호 배타 (연습대회 없음).
 * - all: PUBLISHED 전체
 * - upcoming: 접수 시작 전
 * - recruiting: 접수 기간 중
 * - in_progress: 접수 종료 후 · 프로그램 종료 전(또는 endAt 없음)
 * - ended: endAt 경과 또는 ARCHIVED
 */
function recruitmentWhere(
  status: ProgramListQueryStatus,
  now: Date,
): Prisma.ProgramWhereInput {
  const whereByStatus = {
    all: { lifecycle: ProgramLifecycle.PUBLISHED },
    upcoming: {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { gt: now },
    },
    recruiting: {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
    },
    in_progress: {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationEndAt: { lt: now },
      OR: [{ endAt: null }, { endAt: { gte: now } }],
    },
    ended: {
      OR: [
        { lifecycle: ProgramLifecycle.ARCHIVED },
        {
          lifecycle: ProgramLifecycle.PUBLISHED,
          endAt: { not: null, lt: now },
        },
      ],
    },
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
  if (status === 'ended') {
    conditions.push(
      Prisma.sql`(p."lifecycle" = 'ARCHIVED' OR (p."lifecycle" = 'PUBLISHED' AND p."endAt" IS NOT NULL AND p."endAt" < ${now}))`,
    );
  } else {
    conditions.push(Prisma.sql`p."lifecycle" = 'PUBLISHED'`);
    if (status === 'upcoming') {
      conditions.push(Prisma.sql`p."applicationStartAt" > ${now}`);
    } else if (status === 'recruiting') {
      conditions.push(
        Prisma.sql`p."applicationStartAt" <= ${now} AND p."applicationEndAt" >= ${now}`,
      );
    } else if (status === 'in_progress') {
      conditions.push(
        Prisma.sql`p."applicationEndAt" < ${now} AND (p."endAt" IS NULL OR p."endAt" >= ${now})`,
      );
    }
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
          p."endAt",
          p."description"
        FROM "Program" AS p
        ${sqlWhere}
        ORDER BY
          CASE
            WHEN p."applicationStartAt" <= ${now}
              AND p."applicationEndAt" >= ${now} THEN 0
            WHEN p."applicationStartAt" > ${now} THEN 1
            WHEN p."applicationEndAt" < ${now}
              AND (p."endAt" IS NULL OR p."endAt" >= ${now}) THEN 2
            ELSE 3
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
        lifecycle: true,
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
