import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationStatus,
  type Prisma,
  Role,
} from '@prisma/client';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import { PrismaService } from '../prisma/prisma.service';
import { programApplicationParticipantWhere } from '../programs/program-participant';

export interface StudentApplicationActor {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface StudentApplicationPolicy {
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly applicationTemplateVersion: number;
}

export interface OwnedStudentApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;
  readonly applicant: StudentApplicationActor;
  readonly answers: Prisma.JsonValue;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly isRepositoryPublicationPlanned: boolean;
}

export interface UpdatePendingApplicationRecord {
  readonly applicationId: string;
  readonly answers: Prisma.InputJsonValue;
  readonly applicationTemplateVersion: number;
}

const APPLICATION_SELECT = {
  id: true,
  programId: true,
  status: true,
  teamId: true,
  applicant: {
    select: { id: true, nickname: true, ...COMPATIBLE_PROFILE_NAME_SELECT },
  },
  answers: true,
  submittedAt: true,
  updatedAt: true,
  isRepositoryPublicationPlanned: true,
} as const satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{
  readonly select: typeof APPLICATION_SELECT;
}>;

function toOwnedStudentApplication(
  row: ApplicationRow,
): OwnedStudentApplication {
  return {
    ...row,
    applicant: {
      id: row.applicant.id,
      name: resolveCompatibleProfileName(row.applicant),
      nickname: row.applicant.nickname,
    },
  };
}

@Injectable()
export class StudentApplicationManagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<StudentApplicationActor | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STUDENT,
      },
      select: { id: true, nickname: true, ...COMPATIBLE_PROFILE_NAME_SELECT },
    });
    return user
      ? {
          id: user.id,
          name: resolveCompatibleProfileName(user),
          nickname: user.nickname,
        }
      : null;
  }

  async findOwnedApplication(
    programId: string,
    studentId: string,
  ): Promise<OwnedStudentApplication | null> {
    const row = await this.prisma.application.findFirst({
      where: {
        programId,
        ...programApplicationParticipantWhere(studentId),
      },
      select: APPLICATION_SELECT,
    });
    return row ? toOwnedStudentApplication(row) : null;
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
      const row = await transaction.application.findUnique({
        where: { id: input.applicationId },
        select: APPLICATION_SELECT,
      });
      return row ? toOwnedStudentApplication(row) : null;
    });
  }

  async deletePendingApplication(applicationId: string): Promise<boolean> {
    const result = await this.prisma.application.deleteMany({
      where: { id: applicationId, status: ApplicationStatus.SUBMITTED },
    });
    return result.count === 1;
  }
}
