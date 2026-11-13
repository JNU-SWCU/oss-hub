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
  githubRepoId: true,
  ownerName: true,
  publishedAt: true,
  teamRepos: {
    orderBy: { validFrom: 'desc' },
    take: 1,
    select: {
      team: {
        select: {
          programId: true,
          name: true,
          leaderId: true,
          _count: { select: { members: true } },
          members: { select: { userId: true } },
          program: { select: { name: true, trackType: true, lifecycle: true } },
          applicant: { select: { nickname: true } },
        },
      },
    },
  },
} satisfies Prisma.RepoSelect;

type ProjectRowSelection = Prisma.RepoGetPayload<{
  select: typeof PROJECT_ROW_SELECT;
}>;

const LIVE_PROGRAM_TEAM = {
  program: { lifecycle: { not: 'DELETED' } },
} satisfies Prisma.TeamWhereInput;

function seoulYearBoundsUtcForRead(year: number): readonly [Date, Date] {
  return [
    new Date(Date.UTC(year, 0, 1) - 9 * 60 * 60 * 1000),
    new Date(Date.UTC(year + 1, 0, 1) - 9 * 60 * 60 * 1000),
  ];
}

function toProjectRow(
  row: ProjectRowSelection,
  userId?: string,
): PublicProjectRow | null {
  const team = row.teamRepos[0]?.team;
  if (
    team === undefined ||
    row.publishedAt === null ||
    team.program.lifecycle === 'DELETED' ||
    (userId !== undefined &&
      team.leaderId !== userId &&
      !team.members.some((member) => member.userId === userId))
  )
    return null;
  return {
    id: row.githubRepoId.toString(),
    projectId: row.githubRepoId.toString(),
    githubRepositoryId: row.githubRepoId,
    nameWithOwner: row.ownerName,
    publishedAt: row.publishedAt,
    programId: team.programId,
    programName: team.program.name,
    trackType: team.program.trackType,
    teamName: team.name,
    teamMemberCount: team._count.members,
    applicantNickname: team.applicant.nickname,
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

    const rows = await this.prisma.repo.findMany({
      where: {
        visibility: 'PUBLIC',
        teamRepos: { some: { team: LIVE_PROGRAM_TEAM } },
        publishedAt: publishedAtWhere,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { publishedAt: { lt: cursor.publishedAt } },
                {
                  publishedAt: cursor.publishedAt,
                  githubRepoId: { lt: BigInt(cursor.id) },
                },
              ],
            }),
      },
      orderBy: [{ publishedAt: 'desc' }, { githubRepoId: 'desc' }],
      take,
      select: PROJECT_ROW_SELECT,
    });
    return rows.flatMap((row) => {
      const project = toProjectRow(row);
      return project === null ? [] : [project];
    });
  }

  async findById(projectId: string): Promise<PublicProjectRow | null> {
    if (!/^[0-9]+$/.test(projectId)) return null;

    const row = await this.prisma.repo.findFirst({
      where: {
        githubRepoId: BigInt(projectId),
        visibility: 'PUBLIC',
        teamRepos: { some: { team: LIVE_PROGRAM_TEAM } },
        publishedAt: { not: null },
      },
      select: PROJECT_ROW_SELECT,
    });
    return row === null ? null : toProjectRow(row);
  }

  async listForUser(userId: string): Promise<PublicProjectRow[]> {
    const rows = await this.prisma.repo.findMany({
      where: {
        visibility: 'PUBLIC',
        publishedAt: { not: null },
        teamRepos: {
          some: {
            team: {
              ...LIVE_PROGRAM_TEAM,
              OR: [{ leaderId: userId }, { members: { some: { userId } } }],
            },
          },
        },
      },
      orderBy: [{ publishedAt: 'desc' }, { githubRepoId: 'desc' }],
      select: PROJECT_ROW_SELECT,
    });
    return rows.flatMap((row) => {
      const project = toProjectRow(row, userId);
      return project === null ? [] : [project];
    });
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
