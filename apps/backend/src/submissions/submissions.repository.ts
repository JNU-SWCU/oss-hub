import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  Role,
  type ApplicationStatus,
  type MilestoneSubmissionType,
  type SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSubmissionInput } from './domain/submission-content';
import {
  submissionApplicationSelect,
  submissionParticipantWhere,
  toSubmissionApplication,
} from './submission-application.record';

type SubmissionsDatabase = Pick<
  Prisma.TransactionClient,
  'application' | 'milestone' | 'submission' | 'user'
>;

export interface SubmissionActor {
  readonly id: string;
}

export interface SubmissionMilestone {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly instructions: string | null;
}

export interface SubmissionApplication {
  readonly id: string;
  readonly programId: string;
  readonly teamId: string | null;
  readonly status: ApplicationStatus;
  readonly repositoryUrl: string | null;
  readonly existingSubmission: {
    readonly id: string;
    readonly status: SubmissionStatus;
  } | null;
}

export interface CreatedSubmission {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly submittedAt: Date;
}

export interface SubmissionsStore {
  findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<SubmissionActor | null>;
  findMilestoneByProgram(
    programId: string,
    milestoneId: string,
  ): Promise<SubmissionMilestone | null>;
  findMilestoneById(milestoneId: string): Promise<SubmissionMilestone | null>;
  findParticipantApplication(
    programId: string,
    milestoneId: string,
    userId: string,
  ): Promise<SubmissionApplication | null>;
  findApplicationForParticipant(
    applicationId: string,
    milestoneId: string,
    userId: string,
  ): Promise<SubmissionApplication | null>;
  createSubmission(
    input: CreateSubmissionInput,
    submittedById: string,
  ): Promise<CreatedSubmission>;
}

export class SubmissionAlreadyExistsError extends Error {
  override readonly name = 'SubmissionAlreadyExistsError';
}

class CreatedSubmissionRevisionMissingError extends Error {
  override readonly name = 'CreatedSubmissionRevisionMissingError';
}

const MILESTONE_SELECT = {
  id: true,
  programId: true,
  name: true,
  dueAt: true,
  submissionType: true,
  instructions: true,
} as const;

class PrismaSubmissionsStore implements SubmissionsStore {
  constructor(private readonly database: SubmissionsDatabase) {}

  async findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<SubmissionActor | null> {
    return this.database.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        role: Role.STUDENT,
      },
      select: { id: true },
    });
  }

  findMilestoneByProgram(programId: string, milestoneId: string) {
    return this.database.milestone.findFirst({
      where: { id: milestoneId, programId },
      select: MILESTONE_SELECT,
    });
  }

  findMilestoneById(milestoneId: string) {
    return this.database.milestone.findUnique({
      where: { id: milestoneId },
      select: MILESTONE_SELECT,
    });
  }

  async findParticipantApplication(
    programId: string,
    milestoneId: string,
    userId: string,
  ): Promise<SubmissionApplication | null> {
    const application = await this.database.application.findFirst({
      where: { programId, ...submissionParticipantWhere(userId) },
      select: submissionApplicationSelect(milestoneId),
    });
    return application ? toSubmissionApplication(application) : null;
  }

  async findApplicationForParticipant(
    applicationId: string,
    milestoneId: string,
    userId: string,
  ): Promise<SubmissionApplication | null> {
    const application = await this.database.application.findFirst({
      where: { id: applicationId, ...submissionParticipantWhere(userId) },
      select: submissionApplicationSelect(milestoneId),
    });
    return application ? toSubmissionApplication(application) : null;
  }

  async createSubmission(
    input: CreateSubmissionInput,
    submittedById: string,
  ): Promise<CreatedSubmission> {
    try {
      const submission = await this.database.submission.create({
        data: {
          milestoneId: input.milestoneId,
          applicationId: input.applicationId,
          revisions: {
            create: {
              revision: 1,
              submissionType: input.content.type,
              content: input.content,
              comment: input.comment,
              submittedById,
            },
          },
        },
        select: {
          id: true,
          status: true,
          revisions: { select: { submittedAt: true }, take: 1 },
        },
      });
      const revision = submission.revisions[0];
      if (!revision) throw new CreatedSubmissionRevisionMissingError();
      return {
        id: submission.id,
        status: submission.status,
        submittedAt: revision.submittedAt,
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new SubmissionAlreadyExistsError();
      }
      throw error;
    }
  }
}

@Injectable()
export class SubmissionsRepository implements SubmissionsStore {
  private readonly store: PrismaSubmissionsStore;

  constructor(private readonly prisma: PrismaService) {
    this.store = new PrismaSubmissionsStore(prisma);
  }

  findActiveStudentByGithubId(githubId: bigint) {
    return this.store.findActiveStudentByGithubId(githubId);
  }

  findMilestoneByProgram(programId: string, milestoneId: string) {
    return this.store.findMilestoneByProgram(programId, milestoneId);
  }

  findMilestoneById(milestoneId: string) {
    return this.store.findMilestoneById(milestoneId);
  }

  findParticipantApplication(
    programId: string,
    milestoneId: string,
    userId: string,
  ) {
    return this.store.findParticipantApplication(
      programId,
      milestoneId,
      userId,
    );
  }

  findApplicationForParticipant(
    applicationId: string,
    milestoneId: string,
    userId: string,
  ) {
    return this.store.findApplicationForParticipant(
      applicationId,
      milestoneId,
      userId,
    );
  }

  createSubmission(input: CreateSubmissionInput, submittedById: string) {
    return this.store.createSubmission(input, submittedById);
  }

  withTransaction<T>(
    operation: (store: SubmissionsStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaSubmissionsStore(transaction)),
    );
  }
}
