import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/error-code';
import type { ProgramActivityResponseDto } from '../dto/program-detail.dto';
import type {
  ActivityPointResponseDto,
  ActivityTimelineResponseDto,
} from '../dto/activity-timeline.dto';
import type { ActivityGranularity } from '../program-activity-granularity';
import { PROGRAM_ERROR_CODES } from '../program-error-code';
import {
  ProgramErrorCode,
  PROGRAM_ERROR_CODES as CREATION_ERROR_CODES,
} from '../program-error-code.enum';
import type { ProgramViewer } from './program-viewer.service';
import {
  ProgramActivityRepository,
  type ProgramRepositoryActivity,
} from '../repository/program-activity.repository';
import { ProgramsRepository } from '../repository/programs.repository';

export type ProgramActivityProgramStore = Pick<
  ProgramsRepository,
  'findProgramRepositories' | 'findStudentActivityApplications'
>;

function seoulPeriod(date: Date, granularity: ActivityGranularity): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    ...(granularity === 'MONTH' ? { month: '2-digit' as const } : {}),
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || (granularity === 'MONTH' && !month)) {
    throw new Error('Failed to format activity period.');
  }
  return granularity === 'MONTH' ? `${year}-${month}` : year;
}

@Injectable()
export class ProgramActivityService {
  constructor(
    @Inject(ProgramsRepository)
    private readonly repository: ProgramActivityProgramStore,
    @Inject(ProgramActivityRepository)
    private readonly activityReads: Pick<
      ProgramActivityRepository,
      'findRepositoryActivity' | 'findProgramActivityApplications'
    >,
  ) {}

  async activity(
    programId: string,
    viewer: ProgramViewer,
  ): Promise<readonly ProgramActivityResponseDto[]> {
    if (!viewer.userId || !viewer.role || viewer.role === 'PENDING') return [];
    try {
      const applications =
        await this.activityReads.findProgramActivityApplications(
          programId,
          viewer.role === 'STUDENT' ? viewer.userId : null,
        );
      return applications.map((application): ProgramActivityResponseDto => {
        const repository = application.repository;
        const totals = {
          commitCount: repository?._count.commits ?? 0,
          pullRequestCount: repository?._count.pullRequests ?? 0,
          releaseCount: repository?._count.releases ?? 0,
        };
        const contributions = new Map<bigint, typeof totals>();
        for (const row of repository?.contributions ?? []) {
          const previous = contributions.get(row.githubId);
          contributions.set(row.githubId, {
            commitCount: (previous?.commitCount ?? 0) + row.commitCount,
            pullRequestCount:
              (previous?.pullRequestCount ?? 0) + row.pullRequestCount,
            releaseCount: (previous?.releaseCount ?? 0) + row.releaseCount,
          });
        }
        const members = repository
          ? application.team.members.map(({ user }) => ({
              githubLogin: user.nickname,
              commitCount: contributions.get(user.githubId)?.commitCount ?? 0,
              pullRequestCount:
                contributions.get(user.githubId)?.pullRequestCount ?? 0,
              releaseCount: contributions.get(user.githubId)?.releaseCount ?? 0,
            }))
          : [];
        const memberTotals = members.reduce(
          (sum, member) => ({
            commitCount: sum.commitCount + member.commitCount,
            pullRequestCount: sum.pullRequestCount + member.pullRequestCount,
            releaseCount: sum.releaseCount + member.releaseCount,
          }),
          { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
        );
        let lastActivityAt: Date | null = null;
        if (repository) {
          for (const date of [
            ...repository.commits.map((row) => row.committedAt),
            ...repository.pullRequests.map((row) => row.createdAt),
            ...repository.releases.map((row) => row.publishedAt),
          ]) {
            if (!lastActivityAt || lastActivityAt < date) {
              lastActivityAt = date;
            }
          }
        }
        return {
          applicationId: application.id,
          label: application.team.name,
          ...totals,
          lastActivityAt: lastActivityAt?.toISOString() ?? null,
          dataAsOf: repository?.lastSuccessAt?.toISOString() ?? null,
          collectionStatus: !repository
            ? 'NOT_CONNECTED'
            : repository.failureCount > 0
              ? 'FAILED'
              : totals.commitCount +
                    totals.pullRequestCount +
                    totals.releaseCount ===
                  0
                ? 'EMPTY'
                : 'READY',
          members,
          hasIncompleteContributions:
            totals.commitCount !== memberTotals.commitCount ||
            totals.pullRequestCount !== memberTotals.pullRequestCount ||
            totals.releaseCount !== memberTotals.releaseCount,
        };
      });
    } catch {
      throw new DomainException(PROGRAM_ERROR_CODES.DETAIL_LOAD_FAILED);
    }
  }

  async activityTimeline(
    viewer: ProgramViewer,
    granularity: ActivityGranularity,
  ): Promise<ActivityTimelineResponseDto> {
    if (viewer.role !== 'STUDENT' || !viewer.userId || !viewer.githubId) {
      throw new DomainException(
        CREATION_ERROR_CODES[ProgramErrorCode.FORBIDDEN],
      );
    }

    try {
      const applications =
        await this.repository.findStudentActivityApplications(viewer.userId);
      const repositoryIds = [
        ...new Set(
          applications.flatMap((application) =>
            application.repository
              ? [application.repository.githubRepositoryId]
              : [],
          ),
        ),
      ];
      const activity = await this.activityReads.findRepositoryActivity({
        repositoryIds,
        authorGithubId: viewer.githubId,
      });
      const canonicalByRepository = new Map<
        bigint,
        ProgramRepositoryActivity
      >();
      for (const record of activity) {
        const current = canonicalByRepository.get(record.repositoryId);
        if (!current || current.dataAsOf < record.dataAsOf) {
          canonicalByRepository.set(record.repositoryId, record);
        }
      }

      const points = new Map<string, ActivityPointResponseDto>();
      const add = (
        date: Date,
        metric: 'commitCount' | 'pullRequestCount' | 'releaseCount',
      ) => {
        const period = seoulPeriod(date, granularity);
        const current = points.get(period) ?? {
          period,
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
          total: 0,
        };
        points.set(period, {
          ...current,
          [metric]: current[metric] + 1,
          total: current.total + 1,
        });
      };
      for (const repository of canonicalByRepository.values()) {
        repository.commitDates.forEach((date) => add(date, 'commitCount'));
        repository.pullRequestDates.forEach((date) =>
          add(date, 'pullRequestCount'),
        );
        repository.releaseDates.forEach((date) => add(date, 'releaseCount'));
      }

      const programs = [
        ...new Map(
          applications.map((application) => [
            application.program.id,
            {
              programId: application.program.id,
              programName: application.program.name,
              year: Number(
                seoulPeriod(application.program.applicationStartAt, 'YEAR'),
              ),
              applicationMode:
                application.teamId === null
                  ? ('PERSONAL' as const)
                  : ('TEAM' as const),
            },
          ]),
        ).values(),
      ].sort((left, right) =>
        left.year === right.year
          ? left.programName.localeCompare(right.programName)
          : left.year - right.year,
      );
      const dataAsOf = [...canonicalByRepository.values()].reduce<Date | null>(
        (latest, generation) =>
          latest && latest > generation.dataAsOf ? latest : generation.dataAsOf,
        null,
      );

      return {
        dataAsOf: dataAsOf?.toISOString() ?? null,
        programs,
        series: {
          granularity,
          points: [...points.values()].sort((left, right) =>
            left.period.localeCompare(right.period),
          ),
        },
      };
    } catch {
      throw new DomainException(PROGRAM_ERROR_CODES.DETAIL_LOAD_FAILED);
    }
  }
}
