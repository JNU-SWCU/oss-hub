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
import type { ProgramListQuery } from './program-list-query';
import {
  emptyProgramStatusCounts,
  programListPrismaWhere,
  programListSortRankSql,
  programListSqlWhere,
  programStatusCountsSql,
  type ProgramStatusCounts,
} from './program-list-status-filter';
import { programApplicationParticipantWhere } from './program-participant';

export type { ProgramStatusCounts };
export type ProgramListRecord = Pick<
  Program,
  | 'id'
  | 'name'
  | 'organizer'
  | 'category'
  | 'lifecycle'
  | 'applicationStartAt'
  | 'applicationEndAt'
  | 'endAt'
  | 'description'
>;

@Injectable()
export class ProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listPrograms(query: ProgramListQuery, now: Date) {
    const where: Prisma.ProgramWhereInput = {
      ...programListPrismaWhere(query.status, now),
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
          p."lifecycle",
          p."applicationStartAt",
          p."applicationEndAt",
          p."endAt",
          p."description"
        FROM "Program" AS p
        ${sqlWhere}
        ORDER BY
          ${programListSortRankSql(now)} ASC,
          p."applicationEndAt" ASC,
          p."name" ASC,
          p."id" ASC
        LIMIT ${query.pageSize}
        OFFSET ${offset}
      `),
      this.prisma.program.count({ where }),
    ]);
  }

  /**
   * 공개 목록 status 필터와 동일 규칙의 5키 카운트.
   * 목록 `totalItems` 와 키가 항상 일치해야 사이드바 뱃지가 신뢰된다.
   */
  async countProgramsByStatus(now: Date): Promise<ProgramStatusCounts> {
    const rows = await this.prisma.$queryRaw<
      readonly {
        readonly all: number;
        readonly recruiting: number;
        readonly in_progress: number;
        readonly upcoming: number;
        readonly ended: number;
      }[]
    >(programStatusCountsSql(now));
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
