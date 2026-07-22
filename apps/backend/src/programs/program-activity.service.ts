import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import type { ProgramActivityResponseDto } from './dto/program-detail.dto';
import { PROGRAM_ERROR_CODES } from './program-error-code';
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
}
