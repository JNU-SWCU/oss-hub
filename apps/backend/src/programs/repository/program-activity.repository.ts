import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { programApplicationParticipantWhere } from '../program-participant';

export interface ProgramRepositoryActivityQuery {
  readonly repositoryIds: readonly bigint[];
  readonly authorGithubId?: bigint;
}

export interface ProgramRepositoryActivity {
  readonly repositoryId: bigint;
  readonly dataAsOf: Date;
  readonly commitDates: readonly Date[];
  readonly pullRequestDates: readonly Date[];
  readonly releaseDates: readonly Date[];
}

/**
 * Program surfaces may read org-provisioned repositories, or external
 * public repositories only when an application link is proven.
 */
function linkedRepositoryFilter(): Prisma.GithubRepositoryWhereInput {
  return {
    OR: [
      { source: 'ORG_PROVISIONED' },
      { source: 'EXTERNAL_PUBLIC', applicationId: { not: null } },
    ],
  };
}

@Injectable()
export class ProgramActivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProgramActivityApplications(
    programId: string,
    studentUserId: string | null,
  ) {
    return this.prisma.application.findMany({
      where: {
        programId,
        AND: [
          {
            OR: [
              { repository: { is: linkedRepositoryFilter() } },
              { status: 'APPROVED', repository: null },
            ],
          },
          ...(studentUserId
            ? [programApplicationParticipantWhere(studentUserId)]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        team: {
          select: {
            name: true,
            members: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: { user: { select: { githubId: true, nickname: true } } },
            },
          },
        },
        repository: {
          select: {
            lastSuccessAt: true,
            failureCount: true,
            _count: {
              select: { commits: true, pullRequests: true, releases: true },
            },
            commits: {
              orderBy: { committedAt: 'desc' },
              take: 1,
              select: { committedAt: true },
            },
            pullRequests: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true },
            },
            releases: {
              orderBy: { publishedAt: 'desc' },
              take: 1,
              select: { publishedAt: true },
            },
            contributions: {
              select: {
                githubId: true,
                commitCount: true,
                pullRequestCount: true,
                releaseCount: true,
              },
            },
          },
        },
      },
    });
  }

  async findRepositoryActivity(
    query: ProgramRepositoryActivityQuery,
  ): Promise<readonly ProgramRepositoryActivity[]> {
    if (query.repositoryIds.length === 0) return [];

    const authorWhere = query.authorGithubId
      ? { authorGithubId: query.authorGithubId }
      : undefined;

    const repositories = await this.prisma.githubRepository.findMany({
      where: {
        githubRepositoryId: { in: [...query.repositoryIds] },
        ...linkedRepositoryFilter(),
      },
      select: {
        githubRepositoryId: true,
        updatedAt: true,
        lastCompleteInventoryObservedAt: true,
        commits: {
          where: authorWhere,
          select: { committedAt: true },
        },
        pullRequests: {
          where: authorWhere,
          select: { createdAt: true },
        },
        releases: {
          where: authorWhere,
          select: { publishedAt: true },
        },
      },
    });

    return repositories.map((repository) => ({
      repositoryId: repository.githubRepositoryId,
      dataAsOf:
        repository.lastCompleteInventoryObservedAt ?? repository.updatedAt,
      commitDates: repository.commits.map((commit) => commit.committedAt),
      pullRequestDates: repository.pullRequests.map(
        (pullRequest) => pullRequest.createdAt,
      ),
      releaseDates: repository.releases.map((release) => release.publishedAt),
    }));
  }
}
