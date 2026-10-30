import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { linkedRepositoryFilter } from '../platform/platform.repository';
import { programApplicationParticipantWhere } from '../platform/program-application-participant.repository';

export interface ProgramRepositoryLink {
  readonly programId: string;
  readonly githubRepositoryId: bigint;
}

export interface ProgramActivitySummaryDataSource {
  readonly githubRepository: {
    findMany(args: {
      readonly where: {
        readonly programId: { readonly in: string[] };
        readonly applicationId: { readonly not: null };
      };
      readonly select: {
        readonly programId: true;
        readonly githubRepositoryId: true;
      };
    }): Promise<
      readonly { programId: string | null; githubRepositoryId: bigint }[]
    >;
  };
}

@Injectable()
export class ProgramActivitySummaryRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: ProgramActivitySummaryDataSource,
  ) {}

  async findRepositoryLinks(
    programIds: readonly string[],
  ): Promise<readonly ProgramRepositoryLink[]> {
    if (programIds.length === 0) return [];
    const rows = await this.prisma.githubRepository.findMany({
      where: {
        programId: { in: [...programIds] },
        applicationId: { not: null },
      },
      select: { programId: true, githubRepositoryId: true },
    });

    return rows.filter(
      (row): row is { programId: string; githubRepositoryId: bigint } =>
        row.programId !== null,
    );
  }
}

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
  readonly issueDates: readonly Date[];
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
            failureCount: true,
            streams: { select: { lastRunAt: true } },
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
        issues: {
          where: authorWhere,
          select: { createdAt: true },
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
      issueDates: repository.issues.map((issue) => issue.createdAt),
    }));
  }
}
