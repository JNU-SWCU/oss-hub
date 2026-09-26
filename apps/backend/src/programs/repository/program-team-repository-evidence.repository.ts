import type { ApplicationStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { repositoryUrlFromNameWithOwner } from '../../github/repository-identity';
import type {
  TeamActivityCounts,
  TeamActivityView,
  TeamOutsiderContributionsView,
  TeamRepositoryContributionsView,
  RepositoryUrlHistoryPage,
  RepositoryUrlHistoryCursor,
  RepositoryUrlHistoryView,
} from '../program-team-repository-evidence.types';
import {
  APPLICATION_REPOSITORY_URL_CHANGED,
  parseApplicationRepositoryUrlAuditMetadata,
} from '../../audit-log/application-repository-url-audit-metadata';
import {
  REPOSITORY_CONNECTION_AUDIT_ACTIONS,
  parseRepositoryConnectionAuditMetadata,
} from '../../audit-log/repository-program-audit-metadata';

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

/** 팀 저장소 활동을 그릴 재료 — 지금 팀원과 지금 신청에 걸린 저장소뿐이다. */
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
  ): Promise<RepositoryUrlHistoryPage> {
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
              // 걷어 낸 교직원 연결 endpoint가 남긴 옛 기록도 같은 이력이다 — 한 줄로 섞어
              // 시간순 한 커서로 넘긴다.
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
    const items = rows.slice(0, 20).map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      ...repositoryUrlChange(row, scope),
    }));
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
      // 창 안에서 네 수가 모두 0인 사람(기여 행만 남은 사람)은 세우지 않는다. Issue만 연
      // 사람은 교직원 화면이 Issue 수를 보이므로(#1133) 목록에 오른다.
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
      repositoryUrl: repositoryUrlFromNameWithOwner(repository.nameWithOwner),
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

  /**
   * 수집이 세어 둔 「팀원이 아닌 사람의 기여」 — 센 기준(신청·프로그램·기간)이 지금과 같을 때만 쓴다.
   * 기간을 고쳤거나 저장소가 다른 팀·프로그램에서 넘어왔으면 다음 수집이 다시 셀 때까지 보이지 않는다.
   */
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

  /**
   * 팀 저장소 활동(#1133) — 지금 신청에 걸린 저장소의, 지금 팀원의, 프로그램 기간 안
   * 일별 기여 행을 그대로 옮긴다. 저장소를 바꾸면 옛 저장소의 행은 여기서 사라진다.
   *
   * 수집을 한 번도 끝내지 못한 저장소는 행이 있어도 싣지 않는다 — 끝나지 않은 첫 수집의
   * 일부를 「이만큼 했다」로 그릴 수 없다. 실패 중이어도 끝낸 적이 있으면 마지막 값을 싣는다.
   */
  async activity(
    team: TeamActivityScope,
  ): Promise<Omit<TeamActivityView, 'canEditRepositoryUrl'>> {
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
            // 릴리스만 있는 날은 이 화면이 세는 세 지표가 모두 0이다 — 점으로 찍지 않는다.
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
        url: repositoryUrlFromNameWithOwner(repository.nameWithOwner),
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

/**
 * 프로그램 기간을 서울 달력 날짜로 옮긴다. 센티널 끝(`9999-12-31T23:59:59.999Z`)은
 * 서울에서 이미 다음 해라 `+010000-01-01`이 된다 — 자르지 않고 그대로 싣는다.
 */
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

/** `Contribution.date`는 서울 날짜 칸이라 창의 두 끝 날짜와 그대로 비교한다. */
function windowDates(window: { readonly from: string; readonly to: string }) {
  return {
    gte: new Date(`${window.from}T00:00:00Z`),
    // Prisma는 네 자리 연도만 넘긴다. 센티널 끝(`+010000-01-01`)은 그 앞의 마지막
    // 날로 비교한다 — 그보다 뒤 날짜의 기여 행은 없으니 결과가 같다.
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

function repositoryUrlChange(
  row: {
    readonly action: string;
    readonly metadata: unknown;
    readonly actor: { readonly nickname: string };
  },
  scope: {
    readonly programId: string;
    readonly teamId: string;
    readonly applicationId: string;
  },
): Omit<RepositoryUrlHistoryView, 'id' | 'occurredAt'> {
  if (row.action !== REPOSITORY_CONNECTION_CHANGED) {
    const metadata = parseApplicationRepositoryUrlAuditMetadata(row.metadata);
    if (
      metadata?.programId === scope.programId &&
      metadata.teamId === scope.teamId
    )
      return {
        actorGithubLogin: metadata.actorGithubLogin,
        previousRepositoryUrl: metadata.before.repositoryUrl,
        newRepositoryUrl: metadata.after.repositoryUrl,
      };
    throw new InvalidRepositoryUrlHistoryError();
  }
  // 옛 기록은 행위자 login을 담지 않아 감사 행의 행위자(지금 login)로 읽는다. 주소는 새
  // 기록과 같게 걸린 저장소의 owner/name에서 만든다.
  const metadata = parseRepositoryConnectionAuditMetadata(row.metadata);
  if (
    metadata?.applicationId !== scope.applicationId ||
    !metadata.after.nameWithOwner
  )
    throw new InvalidRepositoryUrlHistoryError();
  return {
    actorGithubLogin: row.actor.nickname,
    previousRepositoryUrl: metadata.before.nameWithOwner
      ? repositoryUrlFromNameWithOwner(metadata.before.nameWithOwner)
      : null,
    newRepositoryUrl: repositoryUrlFromNameWithOwner(
      metadata.after.nameWithOwner,
    ),
  };
}

class InvalidRepositoryUrlHistoryError extends Error {
  override readonly name = 'InvalidRepositoryUrlHistoryError';
}
