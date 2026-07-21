import { Injectable } from '@nestjs/common';
import { ObservationSourceType, Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import type { ProgramActivityDto } from './dto/program-detail.dto';
import { PROGRAM_ERROR_CODES } from './program-error-code';
import type { ProgramViewer } from './program-viewer.service';

function property(
  value: Prisma.JsonValue,
  key: string,
): Prisma.JsonValue | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  return key in value ? (value[key] ?? null) : null;
}

function pushEvent(payload: Prisma.JsonValue, repositoryName: string) {
  if (property(payload, 'type') !== 'PushEvent') return null;
  const repo = property(payload, 'repo');
  const fullName = repo ? property(repo, 'name') : null;
  if (typeof fullName !== 'string' || !fullName.endsWith(`/${repositoryName}`))
    return null;
  const eventPayload = property(payload, 'payload');
  const size = eventPayload ? property(eventPayload, 'size') : null;
  const occurredAt = property(payload, 'created_at');
  return {
    commits: typeof size === 'number' && Number.isFinite(size) ? size : 0,
    occurredAt: typeof occurredAt === 'string' ? occurredAt : null,
  };
}

@Injectable()
export class ProgramActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async activity(
    programId: string,
    viewer: ProgramViewer,
  ): Promise<readonly ProgramActivityDto[]> {
    if (!viewer.userId || !viewer.role || viewer.role === 'PENDING') return [];
    try {
      const repositories = await this.prisma.repository.findMany({
        where: {
          programId,
          ...(viewer.role === Role.STUDENT
            ? {
                application: {
                  OR: [
                    { applicantId: viewer.userId },
                    { team: { members: { some: { userId: viewer.userId } } } },
                  ],
                },
              }
            : {}),
        },
        select: {
          name: true,
          application: {
            select: {
              id: true,
              applicant: {
                select: { githubId: true, name: true, login: true },
              },
              team: {
                select: {
                  name: true,
                  members: { select: { user: { select: { githubId: true } } } },
                },
              },
            },
          },
        },
      });

      return Promise.all(
        repositories.map(async (repository) => {
          const githubIds = repository.application.team
            ? repository.application.team.members.map(
                (member) => member.user.githubId,
              )
            : [repository.application.applicant.githubId];
          const observations = await this.prisma.githubRawObservation.findMany({
            where: {
              sourceType: ObservationSourceType.EVENT,
              run: { targetGithubId: { in: githubIds } },
            },
            select: { payload: true },
          });
          const events = observations
            .map((observation) =>
              pushEvent(observation.payload, repository.name),
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
