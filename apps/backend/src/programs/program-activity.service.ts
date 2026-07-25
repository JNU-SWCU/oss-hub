import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
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
  constructor(private readonly repository: ProgramsRepository) {}

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
      const generations = await this.repository.findCanonicalRepositoryActivity(
        repositories.map((repository) => repository.githubRepositoryId),
      );
      const canonicalByRepository = new Map<
        bigint,
        {
          readonly dataAsOf: Date;
          readonly commits: readonly { readonly committedAt: Date }[];
          readonly pullRequests: readonly { readonly createdAt: Date }[];
          readonly releases: readonly { readonly publishedAt: Date }[];
        }
      >();
      for (const generation of generations) {
        for (const repository of generation.activeGeneration?.repositories ??
          []) {
          const current = canonicalByRepository.get(
            repository.githubRepositoryId,
          );
          if (!current || current.dataAsOf < generation.updatedAt) {
            canonicalByRepository.set(repository.githubRepositoryId, {
              dataAsOf: generation.updatedAt,
              commits: repository.commits,
              pullRequests: repository.pullRequests,
              releases: repository.releases,
            });
          }
        }
      }

      return repositories.map((repository) => {
        const canonical = canonicalByRepository.get(
          repository.githubRepositoryId,
        );
        let lastActivityAt: Date | null = null;
        if (canonical) {
          for (const date of [
            ...canonical.commits.map((row) => row.committedAt),
            ...canonical.pullRequests.map((row) => row.createdAt),
            ...canonical.releases.map((row) => row.publishedAt),
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
          commitCount: canonical?.commits.length ?? 0,
          pullRequestCount: canonical?.pullRequests.length ?? 0,
          releaseCount: canonical?.releases.length ?? 0,
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
      const generations = await this.repository.findCanonicalRepositoryActivity(
        repositoryIds,
        viewer.githubId,
      );
      const canonicalByRepository = new Map<
        bigint,
        (typeof generations)[number]
      >();
      for (const generation of generations) {
        for (const repository of generation.activeGeneration?.repositories ??
          []) {
          const current = canonicalByRepository.get(
            repository.githubRepositoryId,
          );
          if (!current || current.updatedAt < generation.updatedAt) {
            canonicalByRepository.set(
              repository.githubRepositoryId,
              generation,
            );
          }
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
      for (const [repositoryId, generation] of canonicalByRepository) {
        const repository = generation.activeGeneration?.repositories.find(
          (candidate) => candidate.githubRepositoryId === repositoryId,
        );
        if (!repository) continue;
        repository.commits.forEach((row) =>
          add(row.committedAt, 'commitCount'),
        );
        repository.pullRequests.forEach((row) => add(row.createdAt, 'prCount'));
        repository.releases.forEach((row) =>
          add(row.publishedAt, 'releaseCount'),
        );
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

      return {
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
