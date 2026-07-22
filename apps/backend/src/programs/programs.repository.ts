import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  CollectionRunStatus,
  ObservationSourceType,
  ProgramCategory,
  RoleRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { programApplicationParticipantWhere } from './program-participant';

@Injectable()
export class ProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
