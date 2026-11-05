import { Injectable } from '@nestjs/common';
import type { Prisma, ProgramTrackType } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';

type CollectionRepositoryVisibility = 'PRIVATE' | 'PUBLIC';

type CollectionRepositoryPresence = 'PRESENT' | 'ABSENT';

interface PublicEligibilityObservation {
  readonly visibility: CollectionRepositoryVisibility;
  readonly presence: CollectionRepositoryPresence;
  readonly observedAt: Date | null;
}

export interface PublicEligibilityInput {
  readonly platformPublic: boolean;
  readonly publishedAt: Date | null;

  readonly observation: PublicEligibilityObservation | null;
}

export interface PublicProjectRow {
  readonly id: string;

  readonly projectId: string;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly publishedAt: Date;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: ProgramTrackType | null;
  readonly teamName: string | null;

  readonly teamMemberCount: number;
  readonly applicantNickname: string;
}

export interface PublicProjectCursor {
  readonly publishedAt: Date;
  readonly id: string;
}

export interface PublicUserIdentity {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;

  readonly githubId: bigint;
}

const PROJECT_ROW_SELECT = {
  id: true, githubRepositoryId: true, nameWithOwner: true, publishedAt: true,
  team: { select: { programId: true, name: true, _count: { select: { members: true } },
    program: { select: { name: true, trackType: true } },
    applicant: { select: { nickname: true } },
  } },
} satisfies Prisma.GithubRepositorySelect;

type ProjectRowSelection = Prisma.GithubRepositoryGetPayload<{ select: typeof PROJECT_ROW_SELECT }>;

function seoulYearBoundsUtcForRead(year: number): readonly [Date, Date] {
  return [
    new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000),
    new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000),
  ];
}

function toProjectRow(row: ProjectRowSelection): PublicProjectRow | null {
  if (row.team === null || row.publishedAt === null) return null;
  return {
    id: row.id,
    projectId: row.githubRepositoryId.toString(),
    githubRepositoryId: row.githubRepositoryId,
    nameWithOwner: row.nameWithOwner,
    publishedAt: row.publishedAt,
    programId: row.team.programId,
    programName: row.team.program.name,
    trackType: row.team.program.trackType,
    teamName: row.team?.name ?? null,
    teamMemberCount: row.team?._count?.members ?? 0,
    applicantNickname: row.team.applicant.nickname,
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
        team: { program: { lifecycle: { not: 'DELETED' } } },
        publishedAt: publishedAtWhere,
        ...(cursor === null
            ? {}
            : {
                OR: [
                    { publishedAt: { lt: cursor.publishedAt } },
                    { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
                ],
            })
    },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take,
    select: PROJECT_ROW_SELECT
});
    return rows.flatMap(row => { const project = toProjectRow(row); return project === null ? [] : [project]; });
  }

  async findById(projectId: string): Promise<PublicProjectRow | null> {
    if (!/^[0-9]+$/.test(projectId)) return null;

    const row = await this.prisma.githubRepository.findFirst({
    where: {
        githubRepositoryId: BigInt(projectId),
        visibility: 'PUBLIC',
        team: { program: { lifecycle: { not: 'DELETED' } } },
        publishedAt: { not: null }
    },
    select: PROJECT_ROW_SELECT
});
    return row === null ? null : toProjectRow(row);
  }

  async listForUser(userId: string): Promise<PublicProjectRow[]> {
    const rows = await this.prisma.githubRepository.findMany({
    where: {
        visibility: 'PUBLIC',
        team: { program: { lifecycle: { not: 'DELETED' } } },
        publishedAt: { not: null },
        OR: [
            { team: { leaderId: userId } },
            { team: { members: { some: { userId } } } }
        ]
    },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    select: PROJECT_ROW_SELECT
});
    return rows.flatMap(row => { const project = toProjectRow(row); return project === null ? [] : [project]; });
  }

  async findUserIdentity(userId: string): Promise<PublicUserIdentity | null> {
    const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, nickname: true, avatarUrl: true, githubId: true }
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
