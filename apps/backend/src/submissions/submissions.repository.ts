import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  Role,
  SubmissionStatus,
  type ApplicationStatus,
  type MilestoneSubmissionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateSubmissionInput,
  SubmissionContentInput,
} from './domain/submission-content';
import {
  submissionApplicationSelect,
  submissionParticipantWhere,
  toSubmissionApplication,
} from './submission-application.record';
import {
  checklistMilestoneOrderBy,
  checklistMilestoneSelect,
  toChecklistMilestone,
} from './submission-checklist.record';

type SubmissionsDatabase = Pick<
  Prisma.TransactionClient,
  'application' | 'milestone' | 'submission' | 'submissionRevision' | 'user'
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

export interface ChecklistApplication {
  readonly id: string;
  readonly teamId: string | null;
  readonly status: ApplicationStatus;
}

export interface ChecklistLatestReview {
  readonly reviewedAt: Date;
  readonly comment: string | null;
}

export interface ChecklistMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly submission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly currentRevision: number;
    readonly latestReview: ChecklistLatestReview | null;
  } | null;
}

export interface ResubmissionTarget {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly currentRevision: number;
  readonly submissionType: MilestoneSubmissionType;
  readonly applicationStatus: ApplicationStatus;
  readonly repositoryUrl: string | null;
}

export interface CreateSubmissionRevisionInput {
  readonly submissionId: string;
  readonly baseRevision: number;
  readonly content: SubmissionContentInput;
  readonly comment: string | null;
  readonly submittedById: string;
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
  findChecklistApplication(
    programId: string,
    userId: string,
  ): Promise<ChecklistApplication | null>;
  listChecklistMilestones(
    programId: string,
    applicationId: string,
  ): Promise<readonly ChecklistMilestone[]>;
  findSubmissionForParticipant(
    submissionId: string,
    userId: string,
  ): Promise<ResubmissionTarget | null>;
  submissionExists(submissionId: string): Promise<boolean>;
  createSubmissionRevision(
    input: CreateSubmissionRevisionInput,
  ): Promise<{ readonly revision: number }>;
}

export class SubmissionAlreadyExistsError extends Error {
  override readonly name = 'SubmissionAlreadyExistsError';
}

export class StaleSubmissionRevisionError extends Error {
  override readonly name = 'StaleSubmissionRevisionError';
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

  findChecklistApplication(
    programId: string,
    userId: string,
  ): Promise<ChecklistApplication | null> {
    return this.database.application.findFirst({
      where: { programId, ...submissionParticipantWhere(userId) },
      select: { id: true, teamId: true, status: true },
    });
  }

  async listChecklistMilestones(
    programId: string,
    applicationId: string,
  ): Promise<readonly ChecklistMilestone[]> {
    const milestones = await this.database.milestone.findMany({
      where: { programId },
      orderBy: checklistMilestoneOrderBy,
      select: checklistMilestoneSelect(applicationId),
    });
    return milestones.map(toChecklistMilestone);
  }

  async findSubmissionForParticipant(
    submissionId: string,
    userId: string,
  ): Promise<ResubmissionTarget | null> {
    const submission = await this.database.submission.findFirst({
      where: {
        id: submissionId,
        application: submissionParticipantWhere(userId),
      },
      select: {
        id: true,
        status: true,
        currentRevision: true,
        milestone: { select: { submissionType: true } },
        application: {
          select: { status: true, repository: { select: { url: true } } },
        },
      },
    });
    if (!submission) return null;
    return {
      id: submission.id,
      status: submission.status,
      currentRevision: submission.currentRevision,
      submissionType: submission.milestone.submissionType,
      applicationStatus: submission.application.status,
      repositoryUrl: submission.application.repository?.url ?? null,
    };
  }

  async submissionExists(submissionId: string): Promise<boolean> {
    const submission = await this.database.submission.findUnique({
      where: { id: submissionId },
      select: { id: true },
    });
    return submission !== null;
  }

  async createSubmissionRevision(
    input: CreateSubmissionRevisionInput,
  ): Promise<{ readonly revision: number }> {
    const nextRevision = input.baseRevision + 1;
    // 재제출 가능 상태·baseRevision을 조건으로 건 optimistic update —
    // 동시 재제출이 끼어들면 count 0이 되어 stale로 끝난다(이전 revision·Review는 보존).
    const updated = await this.database.submission.updateMany({
      where: {
        id: input.submissionId,
        status: SubmissionStatus.CHANGES_REQUESTED,
        currentRevision: input.baseRevision,
      },
      data: {
        status: SubmissionStatus.SUBMITTED,
        currentRevision: nextRevision,
      },
    });
    if (updated.count === 0) throw new StaleSubmissionRevisionError();
    try {
      const revision = await this.database.submissionRevision.create({
        data: {
          submissionId: input.submissionId,
          revision: nextRevision,
          submissionType: input.content.type,
          content: input.content,
          comment: input.comment,
          submittedById: input.submittedById,
        },
        select: { revision: true },
      });
      return revision;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new StaleSubmissionRevisionError();
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

  findChecklistApplication(programId: string, userId: string) {
    return this.store.findChecklistApplication(programId, userId);
  }

  listChecklistMilestones(programId: string, applicationId: string) {
    return this.store.listChecklistMilestones(programId, applicationId);
  }

  findSubmissionForParticipant(submissionId: string, userId: string) {
    return this.store.findSubmissionForParticipant(submissionId, userId);
  }

  submissionExists(submissionId: string) {
    return this.store.submissionExists(submissionId);
  }

  createSubmissionRevision(input: CreateSubmissionRevisionInput) {
    return this.store.createSubmissionRevision(input);
  }

  withTransaction<T>(
    operation: (store: SubmissionsStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaSubmissionsStore(transaction)),
    );
  }
}
