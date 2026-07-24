import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  CollectionRunStatus,
  ObservationSourceType,
  Prisma,
  ProgramCategory,
  RoleRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ProgramListQuery,
  ProgramListQueryStatus,
} from './program-list-query';
import { programApplicationParticipantWhere } from './program-participant';

export const STUDENT_ACTIVITY_OBSERVATION_BATCH_SIZE = 500;

const PROGRAM_LIST_SELECT = {
  id: true,
  name: true,
  organizer: true,
  category: true,
  applicationStartAt: true,
  applicationEndAt: true,
  description: true,
} as const;

export type ProgramListRecord = Prisma.ProgramGetPayload<{
  select: typeof PROGRAM_LIST_SELECT;
}>;

function recruitmentWhere(
  status: ProgramListQueryStatus,
  now: Date,
): Prisma.ProgramWhereInput {
  const whereByStatus = {
    all: {},
    recruiting: {
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
    },
    closed: { applicationEndAt: { lt: now } },
  } satisfies Readonly<
    Record<ProgramListQueryStatus, Prisma.ProgramWhereInput>
  >;
  return whereByStatus[status];
}

@Injectable()
export class ProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listPrograms(query: ProgramListQuery, now: Date) {
    const where: Prisma.ProgramWhereInput = {
      ...recruitmentWhere(query.status, now),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    return this.prisma.$transaction([
      this.prisma.program.findMany({
        where,
        orderBy: [
          { applicationStartAt: 'desc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: PROGRAM_LIST_SELECT,
      }),
      this.prisma.program.count({ where }),
    ]);
  }

  findProgramDetail(programId: string) {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        name: true,
        organizer: true,
        category: true,
        description: true,
        applicationStartAt: true,
        applicationEndAt: true,
        milestones: {
          orderBy: { dueAt: 'asc' as const },
          select: {
            id: true,
            name: true,
            dueAt: true,
            instructions: true,
            submissionType: true,
          },
        },
      },
    });
  }

  findStudentApplication(programId: string, userId: string) {
    return this.prisma.application.findFirst({
      where: {
        programId,
        ...programApplicationParticipantWhere(userId),
      },
      select: {
        id: true,
        status: true,
        submissions: { select: { milestoneId: true, status: true } },
      },
    });
  }

  findApprovedApplications(programId: string) {
    return this.prisma.application.findMany({
      where: { programId, status: ApplicationStatus.APPROVED },
      select: {
        submissions: { select: { milestoneId: true, status: true } },
      },
    });
  }

  findProgramRepositories(programId: string, studentUserId: string | null) {
    return this.prisma.repository.findMany({
      where: {
        programId,
        ...(studentUserId
          ? {
              application: {
                ...programApplicationParticipantWhere(studentUserId),
              },
            }
          : {}),
      },
      select: {
        githubRepositoryId: true,
        application: {
          select: {
            id: true,
            applicant: {
              select: { githubId: true, name: true, nickname: true },
            },
            team: {
              select: {
                name: true,
                leader: { select: { githubId: true } },
                members: { select: { user: { select: { githubId: true } } } },
              },
            },
          },
        },
      },
    });
  }

  findSuccessfulEventObservations(githubIds: readonly bigint[]) {
    return this.prisma.githubRawObservation.findMany({
      where: {
        sourceType: ObservationSourceType.EVENT,
        run: {
          targetGithubId: { in: [...githubIds] },
          status: CollectionRunStatus.SUCCEEDED,
        },
      },
      select: { sourceId: true, payload: true },
    });
  }

  async *findStudentTimelineObservationBatches(
    githubId: bigint,
    repositoryIds: readonly bigint[],
    ownedRepositoryIds: readonly bigint[],
  ) {
    const toRepositoryFilter = (repositoryId: bigint) => ({
      payload: { path: ['repo', 'id'], equals: Number(repositoryId) },
    });
    const safeRepositoryIds = repositoryIds.filter(
      (repositoryId) => repositoryId <= BigInt(Number.MAX_SAFE_INTEGER),
    );
    if (safeRepositoryIds.length === 0) return;
    const repositoryFilters = safeRepositoryIds.map(toRepositoryFilter);
    const ownedRepositoryFilters = ownedRepositoryIds
      .filter((repositoryId) => repositoryId <= BigInt(Number.MAX_SAFE_INTEGER))
      .map(toRepositoryFilter);
    let cursor: string | undefined;

    while (true) {
      const observations = await this.prisma.githubRawObservation.findMany({
        where: {
          sourceType: ObservationSourceType.EVENT,
          run: { status: CollectionRunStatus.SUCCEEDED },
          AND: [
            { OR: repositoryFilters },
            {
              OR: [
                { run: { targetGithubId: githubId } },
                ...(ownedRepositoryFilters.length > 0
                  ? [
                      {
                        AND: [
                          {
                            payload: {
                              path: ['type'],
                              equals: 'WatchEvent',
                            },
                          },
                          {
                            payload: {
                              path: ['payload', 'action'],
                              equals: 'started',
                            },
                          },
                          { OR: ownedRepositoryFilters },
                        ],
                      } satisfies Prisma.GithubRawObservationWhereInput,
                    ]
                  : []),
              ],
            },
          ],
        },
        select: {
          id: true,
          sourceId: true,
          payload: true,
          run: { select: { targetGithubId: true } },
        },
        orderBy: { id: 'asc' },
        take: STUDENT_ACTIVITY_OBSERVATION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (observations.length === 0) return;
      yield observations;
      if (observations.length < STUDENT_ACTIVITY_OBSERVATION_BATCH_SIZE) return;
      cursor = observations.at(-1)?.id;
    }
  }

  findStudentOwnedRepositoryIds(
    githubId: bigint,
    repositoryIds: readonly bigint[],
  ) {
    if (repositoryIds.length === 0) return Promise.resolve([]);
    return this.prisma.repositoryOwnerProjection.findMany({
      where: {
        ownerGithubId: githubId,
        githubRepositoryId: { in: [...repositoryIds] },
      },
      select: { githubRepositoryId: true },
    });
  }

  findStudentActivityApplications(userId: string) {
    return this.prisma.application.findMany({
      where: {
        status: ApplicationStatus.APPROVED,
        ...programApplicationParticipantWhere(userId),
      },
      select: {
        teamId: true,
        applicant: { select: { githubId: true } },
        team: {
          select: {
            leader: { select: { githubId: true } },
            members: {
              select: { user: { select: { githubId: true } } },
            },
          },
        },
        program: {
          select: { id: true, name: true, applicationStartAt: true },
        },
        repository: { select: { githubRepositoryId: true } },
      },
    });
  }

  findViewer(githubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        accountStatus: true,
        role: true,
        roleRequests: {
          where: { status: RoleRequestStatus.PENDING },
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  findCreatorRole(githubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true, accountStatus: true },
    });
  }

  createProgram(data: {
    readonly name: string;
    readonly organizer: string;
    readonly category: ProgramCategory;
    readonly applicationTemplateKey: string;
    readonly applicationTemplateVersion: number;
    readonly applicationStartAt: Date;
    readonly applicationEndAt: Date;
    readonly teamMinSize: number | null;
    readonly teamMaxSize: number | null;
    readonly description: string;
  }) {
    return this.prisma.program.create({ data });
  }
}
