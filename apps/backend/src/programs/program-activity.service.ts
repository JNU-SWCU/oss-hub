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
import { programParticipantGithubIds } from './program-participant';
import type { ProgramViewer } from './program-viewer.service';
import { ProgramsRepository } from './programs.repository';

function property(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  return key in value
    ? ((value as Record<string, unknown>)[key] ?? null)
    : null;
}

function pushEvent(payload: unknown, githubRepositoryId: bigint) {
  if (property(payload, 'type') !== 'PushEvent') return null;
  const repo = property(payload, 'repo');
  const repositoryId = property(repo, 'id');
  if (
    typeof repositoryId !== 'number' ||
    !Number.isSafeInteger(repositoryId) ||
    BigInt(repositoryId) !== githubRepositoryId
  )
    return null;
  const eventPayload = property(payload, 'payload');
  const size = property(eventPayload, 'size');
  const occurredAt = property(payload, 'created_at');
  return {
    commits: typeof size === 'number' && Number.isFinite(size) ? size : 0,
    occurredAt: typeof occurredAt === 'string' ? occurredAt : null,
  };
}

type TimelineMetric = 'commitCount' | 'prCount' | 'starCount';

function timelineEvent(
  payload: unknown,
  repositoryIds: ReadonlySet<bigint>,
  ownedRepositoryIds: ReadonlySet<bigint>,
  isCurrentUserEvent: boolean,
  granularity: ActivityGranularity,
): {
  readonly period: string;
  readonly metric: TimelineMetric;
  readonly count: number;
} | null {
  const repositoryId = property(property(payload, 'repo'), 'id');
  if (
    typeof repositoryId !== 'number' ||
    !Number.isSafeInteger(repositoryId) ||
    !repositoryIds.has(BigInt(repositoryId))
  )
    return null;

  const occurredAt = property(payload, 'created_at');
  if (typeof occurredAt !== 'string') return null;
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return null;
  const period = date.toISOString().slice(0, granularity === 'MONTH' ? 7 : 4);
  const type = property(payload, 'type');
  const eventPayload = property(payload, 'payload');

  switch (type) {
    case 'PushEvent': {
      if (!isCurrentUserEvent) return null;
      const size = property(eventPayload, 'size');
      return typeof size === 'number' && Number.isSafeInteger(size) && size >= 0
        ? { period, metric: 'commitCount', count: size }
        : null;
    }
    case 'PullRequestEvent':
      return isCurrentUserEvent && property(eventPayload, 'action') === 'opened'
        ? { period, metric: 'prCount', count: 1 }
        : null;
    case 'WatchEvent':
      return ownedRepositoryIds.has(BigInt(repositoryId)) &&
        property(eventPayload, 'action') === 'started'
        ? { period, metric: 'starCount', count: 1 }
        : null;
    default:
      return null;
  }
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

      return Promise.all(
        repositories.map(async (repository) => {
          const githubIds = programParticipantGithubIds(
            repository.application.applicant.githubId,
            repository.application.team,
          );
          const observations =
            await this.repository.findSuccessfulEventObservations(githubIds);
          const uniqueObservations = [
            ...new Map(
              observations.map((observation) => [
                observation.sourceId,
                observation,
              ]),
            ).values(),
          ];
          const events = uniqueObservations
            .map((observation) =>
              pushEvent(observation.payload, repository.githubRepositoryId),
            )
            .filter((event) => event !== null);
          const lastActivityAt =
            events
              .map((event) => event.occurredAt)
              .filter((value) => value !== null)
              .sort()
              .at(-1) ?? null;
          return {
            applicationId: repository.application.id,
            label:
              repository.application.team?.name ??
              repository.application.applicant.name ??
              repository.application.applicant.login,
            commitCount: events.reduce((sum, event) => sum + event.commits, 0),
            lastActivityAt,
          };
        }),
      );
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
      const repositoryIds = new Set(
        applications.flatMap((application) =>
          application.repository
            ? [application.repository.githubRepositoryId]
            : [],
        ),
      );
      const ownedRepositories =
        await this.repository.findStudentOwnedRepositoryIds(viewer.githubId, [
          ...repositoryIds,
        ]);
      const ownedRepositoryIds = new Set(
        ownedRepositories.map((repository) => repository.githubRepositoryId),
      );
      const observations =
        await this.repository.findStudentTimelineObservations(viewer.githubId, [
          ...ownedRepositoryIds,
        ]);
      const uniqueObservations = [
        ...new Map(
          observations.map((observation) => [
            observation.sourceId,
            observation,
          ]),
        ).values(),
      ];
      const points = new Map<string, ActivityPointResponseDto>();

      for (const observation of uniqueObservations) {
        const event = timelineEvent(
          observation.payload,
          repositoryIds,
          ownedRepositoryIds,
          observation.run.targetGithubId === viewer.githubId,
          granularity,
        );
        if (!event) continue;
        const current = points.get(event.period) ?? {
          period: event.period,
          commitCount: 0,
          prCount: 0,
          starCount: 0,
          total: 0,
        };
        points.set(event.period, {
          ...current,
          [event.metric]: current[event.metric] + event.count,
          total: current.total + event.count,
        });
      }

      const programs = [
        ...new Map(
          applications.map((application) => [
            application.program.id,
            {
              programId: application.program.id,
              programName: application.program.name,
              year: application.program.applicationStartAt.getUTCFullYear(),
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
