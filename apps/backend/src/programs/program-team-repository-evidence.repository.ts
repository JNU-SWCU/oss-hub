import { READ_CAP } from '../platform/bounded-read.config';
import { BoundedReadRepository } from '../platform/bounded-read.repository';
import { COLLECTION_STALE_AFTER_MS } from '../github/collection-app.config';
import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type ApplicationStatus,
  type RepositoryProvisionJobStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import type { PublishBlockedReason } from '../github/repository-publish.config';
import { type TeamDeletionScopeCounts } from './team-deletion-scope.config';

const boundedReads = new BoundedReadRepository();

interface ActivityWindow {
  readonly from: string;
  readonly to: string;
  readonly timeZone: 'Asia/Seoul';
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

export type TeamActivityRow = Omit<
  TeamActivityView,
  'canEditRepositoryUrl' | 'repository'
> & {
  readonly repository: {
    readonly id: string;
    readonly nameWithOwner: string;
    readonly defaultBranch: string | null;
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

interface RepositoryUrlHistoryScope {
  readonly programId: string;
  readonly teamId: string;
}

function repositoryUrlHistoryFilter(scope: RepositoryUrlHistoryScope) {
  return Prisma.sql`h."teamId" = ${scope.teamId} AND h."programId" = ${scope.programId}
    AND h.event = 'REPOSITORY_URL_CHANGED'`;
}

interface TeamActivityCounts {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
}

export interface TeamActivityView {
  readonly teamId: string | null;
  readonly repository: {
    readonly id: string;
    readonly url: string;
    readonly defaultBranch: string | null;
  } | null;
  readonly status: 'NOT_CONNECTED' | 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR';
  readonly lastSuccessAt: string | null;
  readonly window: ActivityWindow;
  readonly canEditRepositoryUrl: boolean;
  readonly repositoryUrlHistoryCount?: number | null;
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
  readonly status: ApplicationStatus;
  readonly repositoryProvisioningStatus: TeamRepositoryProvisioningJobStatus;
  readonly canInvite: boolean;
  readonly canRemoveMembers: boolean;
  readonly canLeave: boolean;
  readonly isLeader: boolean;
  readonly members: readonly TeamMemberView[];
}

type TeamRepositoryProvisioningJobStatus =
  'NOT_REQUESTED' | 'DISABLED' | RepositoryProvisionJobStatus | 'ANOMALOUS';

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
    readonly jobStatus: TeamRepositoryProvisioningJobStatus;
  };
}

export interface StaffTeamDetailView {
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

interface ApplicationRepositorySource {
  readonly id: string;
  readonly repository: {
    readonly githubRepositoryId: bigint;
    readonly nameWithOwner: string;
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
  readonly repositoryUrlHistoryScope?: RepositoryUrlHistoryScope;
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

@Injectable()
export class ProgramTeamRepositoryEvidenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async history(
    scope: RepositoryUrlHistoryScope,
    cursor?: RepositoryUrlHistoryCursor,
  ): Promise<RepositoryUrlHistoryRows> {
    const rows = await this.prisma.$queryRaw<RepositoryUrlHistoryRow[]>`
      SELECT h.id, 'APPLICATION_REPOSITORY_URL_CHANGED' AS action, h."occurredAt",
        h.data->'metadata' AS metadata, jsonb_build_object('nickname', u.login) AS actor
      FROM "TeamHistory" h LEFT JOIN "User" u ON u.id = h."actorId"
      WHERE ${repositoryUrlHistoryFilter(scope)}
        AND (${cursor?.occurredAt ?? null}::timestamp IS NULL
          OR h."occurredAt" < ${cursor?.occurredAt ?? null}
          OR (h."occurredAt" = ${cursor?.occurredAt ?? null} AND h.id < ${cursor?.id ?? null}))
      ORDER BY h."occurredAt" DESC, h.id DESC LIMIT 21
    `;
    return { rows: rows.slice(0, 20), hasMore: rows.length > 20 };
  }

  private async countHistory(
    scope: RepositoryUrlHistoryScope,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM "TeamHistory" h
      WHERE ${repositoryUrlHistoryFilter(scope)}
      LIMIT 1
    `;
    return Number(row.count);
  }

  async activity(team: TeamActivityScope, now: Date): Promise<TeamActivityRow> {
    const repository = team.application?.repository ?? null;
    const [ledger, repositoryUrlHistoryCount] = await Promise.all([
      repository
        ? this.prisma.repo.findUnique({
            where: { githubRepoId: repository.githubRepositoryId },
            select: { lastSuccessAt: true, defaultBranch: true },
          })
        : null,
      team.repositoryUrlHistoryScope
        ? this.countHistory(team.repositoryUrlHistoryScope)
        : undefined,
    ]);
    const lastSuccessAt = ledger?.lastSuccessAt ?? null;
    const window = programWindow(team.program);
    const memberGithubIds = team.members.map((member) => member.user.githubId);
    const bounds = windowDates(window);
    const rows =
      repository && lastSuccessAt && memberGithubIds.length > 0
        ? await boundedReads.readCapped(
            READ_CAP.activityPointsPerTeam,
            'Team activity points',
            (take) =>
              this.prisma.$queryRaw<ActivityPointRow[]>`
            SELECT
              daily.github_id AS "githubId",
              daily.activity_date AS date,
              COUNT(*) FILTER (WHERE daily.kind = 'commit')::int AS "commitCount",
              COUNT(*) FILTER (WHERE daily.kind = 'pull_request')::int AS "pullRequestCount",
              COUNT(*) FILTER (WHERE daily.kind = 'issue')::int AS "issueCount"
            FROM (
              SELECT
                event.author_github_id AS github_id,
                event.kind,
                (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS activity_date
              FROM "contribution" AS event
              WHERE event.repo_id = ${repository.githubRepositoryId}
                AND event.author_github_id IN (${Prisma.join(memberGithubIds)})
                AND event.kind IN (
                  'commit'::"contribution_kind",
                  'pull_request'::"contribution_kind",
                  'issue'::"contribution_kind"
                )
            ) AS daily
            WHERE daily.activity_date >= ${queryDate(bounds.gte)}::date
              AND daily.activity_date <= ${queryDate(bounds.lte)}::date
            GROUP BY daily.github_id, daily.activity_date
            ORDER BY daily.activity_date ASC, daily.github_id ASC
            LIMIT ${take}
          `,
          )
        : [];
    return {
      teamId: team.application?.id ?? null,
      repository: repository && {
        id: repository.githubRepositoryId.toString(),
        nameWithOwner: repository.nameWithOwner,
        defaultBranch: ledger?.defaultBranch ?? null,
      },
      status: repository
        ? collectionStatus(lastSuccessAt, now)
        : 'NOT_CONNECTED',
      lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
      window,
      ...(repositoryUrlHistoryCount === undefined
        ? {}
        : { repositoryUrlHistoryCount }),
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
}): ActivityWindow {
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

function queryDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

interface ActivityPointRow {
  readonly githubId: bigint;
  readonly date: Date;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
}

function collectionStatus(
  lastSuccessAt: Date | null,
  now: Date,
): 'NOT_COLLECTED' | 'COLLECTED' | 'ERROR' {
  if (lastSuccessAt === null) return 'NOT_COLLECTED';
  return now.getTime() - lastSuccessAt.getTime() > COLLECTION_STALE_AFTER_MS
    ? 'ERROR'
    : 'COLLECTED';
}
