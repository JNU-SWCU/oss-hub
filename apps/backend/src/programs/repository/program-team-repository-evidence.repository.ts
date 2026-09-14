import type { PrismaService } from '../../prisma/prisma.service';
import { repositoryUrlFromNameWithOwner } from '../../github/repository-identity';
import type {
  TeamRepositoryContributionsView,
  RepositoryUrlHistoryPage,
  RepositoryUrlHistoryCursor,
} from '../program-team-repository-evidence.types';
import {
  APPLICATION_REPOSITORY_URL_CHANGED,
  parseApplicationRepositoryUrlAuditMetadata,
} from '../../audit-log/application-repository-url-audit-metadata';

interface ApplicationRepositorySource {
  readonly repository: {
    readonly id: string;
    readonly nameWithOwner: string;
    readonly lastSuccessAt: Date | null;
    readonly failureCount: number;
  } | null;
  readonly program: { readonly startAt: Date; readonly endAt: Date };
}

interface TeamRepositoryMember {
  readonly userId: string;
  readonly user: { readonly githubId: bigint };
}

export class ProgramTeamRepositoryEvidenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async history(
    scope: {
      readonly programId: string;
      readonly teamId: string;
      readonly applicationId: string;
    },
    cursor?: RepositoryUrlHistoryCursor,
  ): Promise<RepositoryUrlHistoryPage> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: APPLICATION_REPOSITORY_URL_CHANGED,
        targetType: 'APPLICATION',
        targetId: scope.applicationId,
        AND: [
          { metadata: { path: ['programId'], equals: scope.programId } },
          { metadata: { path: ['teamId'], equals: scope.teamId } },
        ],
        ...(cursor
          ? {
              OR: [
                { occurredAt: { lt: cursor.occurredAt } },
                { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: { id: true, occurredAt: true, metadata: true },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
    const items = rows.slice(0, 20).map((row) => {
      const metadata = parseApplicationRepositoryUrlAuditMetadata(row.metadata);
      if (
        !metadata ||
        metadata.programId !== scope.programId ||
        metadata.teamId !== scope.teamId
      ) {
        throw new InvalidRepositoryUrlHistoryError();
      }
      return {
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorGithubLogin: metadata.actorGithubLogin,
        previousRepositoryUrl: metadata.before.repositoryUrl,
        newRepositoryUrl: metadata.after.repositoryUrl,
        reason: metadata.reason,
      };
    });
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > 20 && last ? `${last.occurredAt}_${last.id}` : null,
    };
  }

  async contributions(
    application: ApplicationRepositorySource,
    members: readonly TeamRepositoryMember[],
  ): Promise<TeamRepositoryContributionsView | null> {
    const repository = application.repository;
    if (!repository) return null;
    const dateFormat = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const calendarDate = (value: Date): string => {
      const parts = Object.fromEntries(
        dateFormat.formatToParts(value).map((part) => [part.type, part.value]),
      );
      const bucket = new Date(0);
      bucket.setUTCFullYear(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
      );
      return bucket.toISOString().replace(/T.*$/, '');
    };
    const from = calendarDate(application.program.startAt);
    const to = calendarDate(application.program.endAt);
    const rows = await this.prisma.contribution.groupBy({
      by: ['githubId'],
      where: {
        repositoryId: repository.id,
        date: {
          gte: new Date(`${from}T00:00:00Z`),
          lte: new Date(`${to}T00:00:00Z`),
        },
      },
      _sum: { commitCount: true, pullRequestCount: true, releaseCount: true },
      orderBy: { githubId: 'asc' },
    });
    const contributors = new Map(
      rows.map((row) => [
        row.githubId,
        {
          githubId: row.githubId.toString(),
          commitCount: row._sum.commitCount ?? 0,
          pullRequestCount: row._sum.pullRequestCount ?? 0,
          releaseCount: row._sum.releaseCount ?? 0,
        },
      ]),
    );
    const memberIds = new Set(members.map((member) => member.user.githubId));
    return {
      repositoryId: repository.id,
      repositoryUrl: repositoryUrlFromNameWithOwner(repository.nameWithOwner),
      window: { from, to, timeZone: 'Asia/Seoul' },
      collectionStatus:
        repository.failureCount > 0
          ? 'ERROR'
          : repository.lastSuccessAt
            ? 'COLLECTED'
            : 'NOT_COLLECTED',
      lastSuccessAt: repository.lastSuccessAt?.toISOString() ?? null,
      members: members.map((member) => ({
        userId: member.userId,
        hasObservations: contributors.has(member.user.githubId),
        ...(contributors.get(member.user.githubId) ?? {
          githubId: member.user.githubId.toString(),
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
        }),
      })),
      unmatchedContributors: [...contributors]
        .filter(([githubId]) => !memberIds.has(githubId))
        .map(([, contributor]) => contributor),
    };
  }
}

class InvalidRepositoryUrlHistoryError extends Error {
  override readonly name = 'InvalidRepositoryUrlHistoryError';
}
