import {
  PublicProjectRow,
  PublicProjectCursor,
  PublicUserIdentity,
} from './domain/public-project-record';
import { Injectable } from '@nestjs/common';
import { type ProgramTrackType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PUBLIC_PROJECT_YEAR_MAX,
  PUBLIC_PROJECT_YEAR_MIN,
} from './domain/public-project-query';
import {
  repositoryNameFromNameWithOwner,
  repositoryUrlFromNameWithOwner,
} from '../../../github/domain/repository-identity';

const PROJECT_ROW_SELECT = {
  id: true,
  githubRepositoryId: true,
  nameWithOwner: true,
  publishedAt: true,
  programId: true,
  program: { select: { name: true, trackType: true } },
  team: { select: { name: true, _count: { select: { members: true } } } },
  application: { select: { applicant: { select: { nickname: true } } } },
} as const;

type ProjectRowSelection = {
  id: string;
  githubRepositoryId: bigint;
  nameWithOwner: string;
  publishedAt: Date | null;
  programId: string | null;
  program: { name: string; trackType: ProgramTrackType | null } | null;
  team: { name: string; _count: { members: number } } | null;
  application: { applicant: { nickname: string } } | null;
};

function seoulYearBoundsUtcForRead(year: number): readonly [Date, Date] {
  if (year < PUBLIC_PROJECT_YEAR_MIN || year > PUBLIC_PROJECT_YEAR_MAX) {
    throw new RangeError(
      `year must be between ${PUBLIC_PROJECT_YEAR_MIN} and ${PUBLIC_PROJECT_YEAR_MAX}`,
    );
  }
  return [
    new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000),
    new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000),
  ];
}

function toProjectRow(row: ProjectRowSelection): PublicProjectRow {
  return {
    id: row.id,
    projectId: row.githubRepositoryId.toString(),
    githubRepositoryId: row.githubRepositoryId,
    repositoryName: repositoryNameFromNameWithOwner(row.nameWithOwner),
    githubUrl: repositoryUrlFromNameWithOwner(row.nameWithOwner),
    publishedAt: row.publishedAt!,
    programId: row.programId!,
    programName: row.program!.name,
    trackType: row.program!.trackType,
    teamName: row.team?.name ?? null,
    teamMemberCount: row.team?._count?.members ?? 0,
    applicantNickname: row.application!.applicant.nickname,
  };
}

@Injectable()
export class PublicProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listPage(
    cursor: PublicProjectCursor | null,
    take: number,
    year?: number,
  ): Promise<PublicProjectRow[]> {
    const publishedAtWhere =
      year === undefined
        ? { not: null }
        : (() => {
            const [yearStart, yearEnd] = seoulYearBoundsUtcForRead(year);
            return { gte: yearStart, lt: yearEnd };
          })();

    const rows = await this.prisma.githubRepository.findMany({
      where: {
        visibility: 'PUBLIC',
        publishedAt: publishedAtWhere,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { publishedAt: { lt: cursor.publishedAt } },
                { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take,
      select: PROJECT_ROW_SELECT,
    });
    return rows.map(toProjectRow);
  }

  async listYears(): Promise<readonly number[]> {
    const rows = await this.prisma.$queryRaw<
      readonly { year: number | null }[]
    >`
      SELECT DISTINCT (
        EXTRACT(
          YEAR FROM (
            r."publishedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'
          )
        )
      )::int AS year
      FROM "GithubRepository" r
      WHERE r.visibility = 'PUBLIC'::"RepositoryVisibility"
        AND r."publishedAt" IS NOT NULL
      ORDER BY year DESC
    `;
    return rows
      .map((row) => row.year)
      .filter((year): year is number => year !== null);
  }

  async findById(projectId: string): Promise<PublicProjectRow | null> {
    if (!/^[0-9]+$/.test(projectId)) return null;

    const row = await this.prisma.githubRepository.findFirst({
      where: {
        githubRepositoryId: BigInt(projectId),
        visibility: 'PUBLIC',
        publishedAt: { not: null },
      },
      select: PROJECT_ROW_SELECT,
    });
    return row === null ? null : toProjectRow(row);
  }

  async listForUser(userId: string): Promise<PublicProjectRow[]> {
    const rows = await this.prisma.githubRepository.findMany({
      where: {
        visibility: 'PUBLIC',
        publishedAt: { not: null },
        OR: [
          { teamId: null, application: { applicantId: userId } },
          { team: { leaderId: userId } },
          { team: { members: { some: { userId } } } },
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: PROJECT_ROW_SELECT,
    });
    return rows.map(toProjectRow);
  }

  async findUserIdentity(userId: string): Promise<PublicUserIdentity | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, nickname: true, avatarUrl: true, githubId: true },
    });
    return user === null
      ? null
      : {
          userId: user.id,
          githubNickname: user.nickname,
          avatarUrl: user.avatarUrl,
          githubId: user.githubId,
        };
  }
}
