import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  type Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { programApplicationParticipantWhere } from '../programs/program-participant';
import type {
  OwnedStudentApplication,
  StudentApplicationActor,
  StudentApplicationPolicy,
  StudentApplicationStore,
  UpdatePendingApplicationRecord,
} from './student-application-management.service';

const APPLICATION_SELECT = {
  id: true,
  programId: true,
  status: true,
  teamId: true,
  answers: true,
  submittedAt: true,
  updatedAt: true,
  isRepositoryPublicationPlanned: true,
} as const satisfies Prisma.ApplicationSelect;

@Injectable()
export class StudentApplicationManagementRepository implements StudentApplicationStore {
  constructor(private readonly prisma: PrismaService) {}

  findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<StudentApplicationActor | null> {
    return this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STUDENT,
      },
      select: { id: true, name: true, nickname: true },
    });
  }

  findOwnedApplication(
    programId: string,
    studentId: string,
  ): Promise<OwnedStudentApplication | null> {
    return this.prisma.application.findFirst({
      where: {
        programId,
        ...programApplicationParticipantWhere(studentId),
      },
      select: APPLICATION_SELECT,
    });
  }

  findProgramPolicy(
    programId: string,
  ): Promise<StudentApplicationPolicy | null> {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        applicationStartAt: true,
        applicationEndAt: true,
        applicationTemplateVersion: true,
      },
    });
  }

  updatePendingApplication(
    input: UpdatePendingApplicationRecord,
  ): Promise<OwnedStudentApplication | null> {
    return this.prisma.$transaction(async (transaction) => {
      const matched = await transaction.application.updateMany({
        where: {
          id: input.applicationId,
          status: ApplicationStatus.SUBMITTED,
        },
        data: {
          answers: input.answers,
          applicationTemplateVersion: input.applicationTemplateVersion,
        },
      });
      if (matched.count !== 1) return null;
      return transaction.application.findUnique({
        where: { id: input.applicationId },
        select: APPLICATION_SELECT,
      });
    });
  }

  async deletePendingApplication(applicationId: string): Promise<boolean> {
    const result = await this.prisma.application.deleteMany({
      where: { id: applicationId, status: ApplicationStatus.SUBMITTED },
    });
    return result.count === 1;
  }
}
