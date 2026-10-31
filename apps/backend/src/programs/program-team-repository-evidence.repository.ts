import type { ApplicationStatus } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import {
  APPLICATION_REPOSITORY_URL_CHANGED,
  REPOSITORY_CONNECTION_AUDIT_ACTIONS,
} from '../platform/repository-audit-metadata.config';
import type { PublishBlockedReason } from '../github/repository-publish.config';
import { type TeamDeletionScopeCounts } from './team-deletion-scope.config';

interface RepositoryContributorView {
  readonly githubId: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly issueCount: number;
}

export interface TeamRepositoryContributionsView {
  readonly repositoryId: string;
  readonly repositoryUrl: string;
  readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: 'Asia/Seoul';
  };
  readonly collectionStatus: 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';
  readonly lastSuccessAt: string | null;
  readonly members: readonly (RepositoryContributorView & {
    readonly userId: string;
    readonly hasObservations: boolean;
  })[];

  readonly outsiderContributions: TeamOutsiderContributionsView | null;
}

export interface TeamOutsiderContributionsView {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
}

export interface RepositoryUrlHistoryView {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorGithubLogin: string;
  readonly previousRepositoryUrl: string | null;
  readonly newRepositoryUrl: string;
}

export interface RepositoryUrlHistoryRow {
  readonly id: string;
  readonly action: string;
  readonly occurredAt: Date;
  readonly metadata: unknown;
  readonly actor: { readonly nickname: string };
}

export interface RepositoryUrlHistoryRows {
  readonly rows: readonly RepositoryUrlHistoryRow[];
  readonly hasMore: boolean;
}

export type TeamRepositoryContributionsRow = Omit<
  TeamRepositoryContributionsView,
  'repositoryUrl'
> & {
  readonly nameWithOwner: string;
};

export type TeamActivityRow = Omit<
  TeamActivityView,
  'canEditRepositoryUrl' | 'repository'
> & {
  readonly repository: {
    readonly id: string;
    readonly nameWithOwner: string;
  } | null;
};

export interface RepositoryUrlHistoryPage {
  readonly items: readonly RepositoryUrlHistoryView[];
  readonly nextCursor: string | null;
}

export interface RepositoryUrlHistoryCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

interface TeamActivityCounts {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
}

export interface TeamActivityView {
  readonly applicationId: string | null;
  readonly repository: { readonly id: string; readonly url: string } | null;
  readonly status: 'NOT_CONNECTED' | 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';
  readonly lastSuccessAt: string | null;
  readonly window: TeamRepositoryContributionsView['window'];
  readonly canEditRepositoryUrl: boolean;
  readonly members: readonly {
    readonly userId: string;
    readonly githubLogin: string;
    readonly totals: TeamActivityCounts;
    readonly points: readonly (TeamActivityCounts & {
      readonly date: string;
    })[];
  }[];
}

export interface TeamMemberView {
  readonly userId: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly isLeader: boolean;
}

export interface RenamedTeamView {
  readonly teamId: string;
  readonly name: string;
}

export interface StaffTeamView {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly TeamMemberView[];
}

export interface ProgramTeamView {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly minMembers: number;
  readonly maxMembers: number;
  readonly hasApplication: boolean;
  readonly canInvite: boolean;
  readonly canRemoveMembers: boolean;
  readonly canLeave: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMemberView[];
}

export type TeamRepositoryProvisioningJobStatus =
  | 'NOT_REQUESTED'
  | 'DISABLED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'RETRYABLE_FAILED'
  | 'FAILED'
  | 'ANOMALOUS';

export type TeamRepositoryProvisioningSafeErrorClass =
  'AUTH' | 'RATE_LIMIT' | 'UPSTREAM_REJECTED' | 'UNKNOWN';

export interface TeamApplicationView {
  readonly id: string;
  readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly repositoryConnectionMode: 'NEW' | 'OWN';
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly visibility: 'PUBLIC' | 'PRIVATE';
    readonly publishEligible: boolean;
    readonly blockedReasons: readonly PublishBlockedReason[];
  } | null;
  readonly repositoryProvisioning: {
    readonly enabled: boolean;
    readonly jobStatus: TeamRepositoryProvisioningJobStatus;
    readonly updatedAt: Date;
    readonly safeErrorClass: TeamRepositoryProvisioningSafeErrorClass | null;
  };
}

interface TeamRepositoryEvidenceView {
  readonly repositoryContributions: TeamRepositoryContributionsView | null;
  readonly repositoryUrlHistory: RepositoryUrlHistoryPage;
}

export interface StaffTeamDetailView extends TeamRepositoryEvidenceView {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly TeamMemberView[];
  readonly application: TeamApplicationView | null;
  readonly deletionScope: TeamDeletionScopeCounts;
}

export interface DeletedTeamView {
  readonly teamId: string;
  readonly deleted: true;
  readonly deletedCounts: Omit<TeamDeletionScopeCounts, 'scopeFingerprint'>;
}

const REPOSITORY_CONNECTION_CHANGED =
  REPOSITORY_CONNECTION_AUDIT_ACTIONS.REPOSITORY_CONNECTION_CHANGED;

interface ApplicationRepositorySource {
  readonly id: string;
  readonly repository: {
    readonly id: string;
    readonly nameWithOwner: string;
    readonly lastSuccessAt: Date | null;
    readonly failureCount: number;
  } | null;
  readonly program: {
    readonly id: string;
    readonly startAt: Date;
    readonly endAt: Date;
  };
}

interface TeamRepositoryMember {
  readonly userId: string;
  readonly user: { readonly githubId: bigint };
}

export interface TeamActivityScope {
  readonly leaderId: string;
  readonly program: { readonly startAt: Date; readonly endAt: Date };
  readonly members: readonly (TeamRepositoryMember & {
    readonly user: { readonly nickname: string };
  })[];
  readonly application: {
    readonly id: string;
    readonly status: ApplicationStatus;
    readonly repository: ApplicationRepositorySource['repository'];
  } | null;
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
  ): Promise<RepositoryUrlHistoryRows> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        targetType: 'APPLICATION',
        targetId: scope.applicationId,
        AND: [
          {
            OR: [
              {
                action: APPLICATION_REPOSITORY_URL_CHANGED,
                AND: [
                  {
                    metadata: { path: ['programId'], equals: scope.programId },
                  },
                  { metadata: { path: ['teamId'], equals: scope.teamId } },
                ],
              },

              {
                action: REPOSITORY_CONNECTION_CHANGED,
                metadata: {
                  path: ['applicationId'],
                  equals: scope.applicationId,
                },
              },
            ],
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { occurredAt: { lt: cursor.occurredAt } },
                    { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        action: true,
        occurredAt: true,
        metadata: true,
        actor: { select: { nickname: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
    return { rows: rows.slice(0, 20), hasMore: rows.length > 20 };
  }

  async contributions(
    application: ApplicationRepositorySource,
    members: readonly TeamRepositoryMember[],
  ): Promise<TeamRepositoryContributionsRow | null> {
    const repository = application.repository;
    if (!repository) return null;
    const window = programWindow(application.program);
    const rows = await this.prisma.contribution.groupBy({
      by: ['githubId'],
      where: { repositoryId: repository.id, date: windowDates(window) },
      _sum: {
        commitCount: true,
        pullRequestCount: true,
        releaseCount: true,
        issueCount: true,
      },

      having: {
        OR: [
          { commitCount: { _sum: { gt: 0 } } },
          { pullRequestCount: { _sum: { gt: 0 } } },
          { releaseCount: { _sum: { gt: 0 } } },
          { issueCount: { _sum: { gt: 0 } } },
        ],
      },
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
          issueCount: row._sum.issueCount ?? 0,
        },
      ]),
    );
    return {
      repositoryId: repository.id,
      nameWithOwner: repository.nameWithOwner,
      window,
      collectionStatus: collectionStatus(repository),
      lastSuccessAt: repository.lastSuccessAt?.toISOString() ?? null,
      members: members.map((member) => ({
        userId: member.userId,
        hasObservations: contributors.has(member.user.githubId),
        ...(contributors.get(member.user.githubId) ?? {
          githubId: member.user.githubId.toString(),
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
          issueCount: 0,
        }),
      })),
      outsiderContributions: await this.outsiderContributions(
        repository.id,
        application,
      ),
    };
  }

  private async outsiderContributions(
    repositoryId: string,
    application: Pick<ApplicationRepositorySource, 'id' | 'program'>,
  ): Promise<TeamOutsiderContributionsView | null> {
    const { program } = application;
    const row =
      await this.prisma.githubRepositoryOutsiderContribution.findUnique({
        where: { repositoryId },
      });
    if (
      row === null ||
      row.applicationId !== application.id ||
      row.programId !== program.id ||
      row.windowStartAt.getTime() !== program.startAt.getTime() ||
      row.windowEndAt.getTime() !== program.endAt.getTime()
    )
      return null;
    return {
      commitCount: row.commitCount,
      pullRequestCount: row.pullRequestCount,
      issueCount: row.issueCount,
    };
  }

  async activity(team: TeamActivityScope): Promise<TeamActivityRow> {
    const repository = team.application?.repository ?? null;
    const window = programWindow(team.program);
    const rows = repository?.lastSuccessAt
      ? await this.prisma.contribution.findMany({
          where: {
            repositoryId: repository.id,
            githubId: {
              in: team.members.map((member) => member.user.githubId),
            },
            date: windowDates(window),

            OR: [
              { commitCount: { gt: 0 } },
              { pullRequestCount: { gt: 0 } },
              { issueCount: { gt: 0 } },
            ],
          },
          select: {
            githubId: true,
            date: true,
            commitCount: true,
            pullRequestCount: true,
            issueCount: true,
          },
          orderBy: { date: 'asc' },
        })
      : [];
    return {
      applicationId: team.application?.id ?? null,
      repository: repository && {
        id: repository.id,
        nameWithOwner: repository.nameWithOwner,
      },
      status: repository ? collectionStatus(repository) : 'NOT_CONNECTED',
      lastSuccessAt: repository?.lastSuccessAt?.toISOString() ?? null,
      window,
      members: team.members.map((member) => {
        const points = rows
          .filter((row) => row.githubId === member.user.githubId)
          .map(({ date, commitCount, pullRequestCount, issueCount }) => ({
            date: date.toISOString().slice(0, 10),
            commitCount,
            pullRequestCount,
            issueCount,
          }));
        const total = (metric: keyof TeamActivityCounts) =>
          points.reduce((sum, point) => sum + point[metric], 0);
        return {
          userId: member.userId,
          githubLogin: member.user.nickname,
          totals: {
            commitCount: total('commitCount'),
            pullRequestCount: total('pullRequestCount'),
            issueCount: total('issueCount'),
          },
          points,
        };
      }),
    };
  }
}

const seoulCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function programWindow(program: {
  readonly startAt: Date;
  readonly endAt: Date;
}): TeamRepositoryContributionsView['window'] {
  const calendarDate = (value: Date): string => {
    const parts = Object.fromEntries(
      seoulCalendar.formatToParts(value).map((part) => [part.type, part.value]),
    );
    const bucket = new Date(0);
    bucket.setUTCFullYear(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
    );
    return bucket.toISOString().replace(/T.*$/, '');
  };
  return {
    from: calendarDate(program.startAt),
    to: calendarDate(program.endAt),
    timeZone: 'Asia/Seoul',
  };
}

const LAST_QUERYABLE_DAY = Date.UTC(9999, 11, 31);

function windowDates(window: { readonly from: string; readonly to: string }) {
  return {
    gte: new Date(`${window.from}T00:00:00Z`),

    lte: new Date(
      Math.min(Date.parse(`${window.to}T00:00:00Z`), LAST_QUERYABLE_DAY),
    ),
  };
}

function collectionStatus(repository: {
  readonly lastSuccessAt: Date | null;
  readonly failureCount: number;
}): 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR' {
  if (repository.failureCount > 0) return 'ERROR';
  return repository.lastSuccessAt ? 'COLLECTED' : 'NOT_COLLECTED';
}
