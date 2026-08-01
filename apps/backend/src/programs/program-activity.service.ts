import { Inject, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
  type CollectionRepositoryActivityDto,
} from '../collection/collection-read.port';
import type { ProgramActivityResponseDto } from './dto/program-detail.dto';
import type {
  ActivityPointResponseDto,
  ActivityTimelineResponseDto,
} from './dto/activity-timeline.dto';
import type { ActivityGranularity } from './program-activity-granularity';
import { PROGRAM_ERROR_CODES } from './program-error-code';
import {
  ProgramErrorCode,
  PROGRAM_ERROR_CODES as CREATION_ERROR_CODES,
} from './program-error-code.enum';
import type { ProgramViewer } from './program-viewer.service';
import { ProgramsRepository } from './programs.repository';

export type ProgramActivityRepository = Pick<
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
    private readonly repository: ProgramActivityRepository,
    @Inject(COLLECTION_READ_PORT)
    private readonly collection: CollectionReadPort,
  ) {}

  async activity(
    programId: string,
    viewer: ProgramViewer,
  ): Promise<readonly ProgramActivityResponseDto[]> {
    if (!viewer.userId || !viewer.role || viewer.role === 'PENDING') return [];
    try {
      const repositories = await this.repository.findProgramRepositories(
        programId,
        viewer.role === Role.STUDENT ? viewer.userId : null,
      );
      const activity = await this.collection.findRepositoryActivity({
        repositoryIds: repositories.map(
          (repository) => repository.githubRepositoryId,
        ),
      });
      const canonicalByRepository = new Map<
        bigint,
        CollectionRepositoryActivityDto
      >();
      for (const record of activity) {
        const current = canonicalByRepository.get(record.repositoryId);
        if (!current || current.dataAsOf < record.dataAsOf) {
          canonicalByRepository.set(record.repositoryId, record);
        }
      }

      return repositories.map((repository) => {
        const canonical = canonicalByRepository.get(
          repository.githubRepositoryId,
        );
        let lastActivityAt: Date | null = null;
        if (canonical) {
          for (const date of [
            ...canonical.commitDates,
            ...canonical.pullRequestDates,
            ...canonical.releaseDates,
          ]) {
            if (!lastActivityAt || lastActivityAt < date) {
              lastActivityAt = date;
            }
          }
        }
        return {
          applicationId: repository.application.id,
          label:
            repository.application.team?.name ??
            repository.application.applicant.name ??
            repository.application.applicant.nickname,
          commitCount: canonical?.commitDates.length ?? 0,
          pullRequestCount: canonical?.pullRequestDates.length ?? 0,
          releaseCount: canonical?.releaseDates.length ?? 0,
          lastActivityAt: lastActivityAt?.toISOString() ?? null,
          dataAsOf: canonical?.dataAsOf.toISOString() ?? null,
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
    if (viewer.role !== Role.STUDENT || !viewer.userId || !viewer.githubId) {
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
      const activity = await this.collection.findRepositoryActivity({
        repositoryIds,
        authorGithubId: viewer.githubId,
      });
      const canonicalByRepository = new Map<
        bigint,
        CollectionRepositoryActivityDto
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
        metric: 'commitCount' | 'prCount' | 'releaseCount',
      ) => {
        const period = seoulPeriod(date, granularity);
        const current = points.get(period) ?? {
          period,
          commitCount: 0,
          prCount: 0,
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
        repository.pullRequestDates.forEach((date) => add(date, 'prCount'));
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
