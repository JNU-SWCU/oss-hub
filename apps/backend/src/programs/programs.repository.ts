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
              select: { githubId: true, name: true, login: true },
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

  findStudentTimelineObservations(
    githubId: bigint,
    ownedRepositoryIds: readonly bigint[],
  ) {
    const watchRepositoryFilters = ownedRepositoryIds
      .filter((repositoryId) => repositoryId <= BigInt(Number.MAX_SAFE_INTEGER))
      .map((repositoryId) => ({
        payload: {
          path: ['repo', 'id'],
          equals: Number(repositoryId),
        },
      }));

    return this.prisma.githubRawObservation.findMany({
      where: {
        sourceType: ObservationSourceType.EVENT,
        run: { status: CollectionRunStatus.SUCCEEDED },
        OR: [
          { run: { targetGithubId: githubId } },
          ...(watchRepositoryFilters.length > 0
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
                    { OR: watchRepositoryFilters },
                  ],
                } satisfies Prisma.GithubRawObservationWhereInput,
              ]
            : []),
        ],
      },
      select: {
        sourceId: true,
        payload: true,
        run: { select: { targetGithubId: true } },
      },
    });
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
      select: { role: true },
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
