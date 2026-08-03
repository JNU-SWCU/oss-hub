import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  Role,
  SubmissionFileLifecycle,
  SubmissionStatus,
  type ApplicationStatus,
  type MilestoneSubmissionType,
  type ReviewDecision,
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
  | 'application'
  | '$queryRaw'
  | 'milestone'
  | 'submission'
  | 'submissionFile'
  | 'submissionRevision'
  | 'user'
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
  readonly programEndAt: Date | null;
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
  readonly decision: ReviewDecision;
  readonly reviewedAt: Date;
  readonly comment: string | null;
}

export interface SubmissionFileMetadata {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: Date;
  readonly downloadUrl: string;
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
    readonly file: SubmissionFileMetadata | null;
  } | null;
}

export interface ResubmissionTarget {
  readonly id: string;
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly programId: string;
  readonly status: SubmissionStatus;
  readonly currentRevision: number;
  readonly submissionType: MilestoneSubmissionType;
  readonly applicationStatus: ApplicationStatus;
  readonly repositoryUrl: string | null;
  readonly dueAt: Date;
}

export interface CreateSubmissionRevisionInput {
  readonly submissionId: string;
  readonly baseRevision: number;
  readonly baseStatus: SubmissionStatus;
  readonly content: SubmissionContentInput;
  readonly comment: string | null;
  readonly submittedById: string;
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly fileExpiresAt: Date | null;
  readonly now: Date;
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
  lockProgramEndAt(programId: string): Promise<Date | null>;
  createSubmission(
    input: CreateSubmissionInput,
    submittedById: string,
    now: Date,
    fileExpiresAt: Date | null,
  ): Promise<CreatedSubmission>;
  findChecklistApplication(
    programId: string,
    userId: string,
  ): Promise<ChecklistApplication | null>;
  listChecklistMilestones(
    programId: string,
    applicationId: string,
    now: Date,
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

export class SubmissionFileUnavailableError extends Error {
  override readonly name = 'SubmissionFileUnavailableError';
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
  program: { select: { endAt: true } },
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

  async findMilestoneByProgram(
    programId: string,
    milestoneId: string,
  ): Promise<SubmissionMilestone | null> {
    const milestone = await this.database.milestone.findFirst({
      where: { id: milestoneId, programId },
      select: MILESTONE_SELECT,
    });
    return milestone ? toSubmissionMilestone(milestone) : null;
  }

  async findMilestoneById(
    milestoneId: string,
  ): Promise<SubmissionMilestone | null> {
    const milestone = await this.database.milestone.findUnique({
      where: { id: milestoneId },
      select: MILESTONE_SELECT,
    });
    return milestone ? toSubmissionMilestone(milestone) : null;
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

  async lockProgramEndAt(programId: string): Promise<Date | null> {
    const programs = await this.database.$queryRaw<
      readonly { endAt: Date | null }[]
    >(Prisma.sql`
      SELECT "endAt"
      FROM "Program"
      WHERE "id" = ${programId}
      FOR UPDATE
    `);
    return programs[0]?.endAt ?? null;
  }
  async createSubmission(
    input: CreateSubmissionInput,
    submittedById: string,
    now: Date,
    fileExpiresAt: Date | null,
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
          revisions: {
            select: { id: true, submittedAt: true },
            take: 1,
          },
        },
      });
      const revision = submission.revisions[0];
      if (!revision) throw new CreatedSubmissionRevisionMissingError();

      if (input.content.type === 'FILE') {
        if (fileExpiresAt === null) throw new SubmissionFileUnavailableError();
        const attached = await this.database.submissionFile.updateMany({
          where: {
            id: input.content.fileId,
            uploaderId: submittedById,
            applicationId: input.applicationId,
            milestoneId: input.milestoneId,
            lifecycle: SubmissionFileLifecycle.PENDING,
            submissionRevisionId: null,
            pendingExpiresAt: { gt: now },
          },
          data: {
            submissionRevisionId: revision.id,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            pendingExpiresAt: null,
            expiresAt: fileExpiresAt,
          },
        });
        if (attached.count !== 1) throw new SubmissionFileUnavailableError();
      }

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
    now: Date,
  ): Promise<readonly ChecklistMilestone[]> {
    const milestones = await this.database.milestone.findMany({
      where: { programId },
      orderBy: checklistMilestoneOrderBy,
      select: checklistMilestoneSelect(applicationId, now),
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
        applicationId: true,
        milestoneId: true,
        status: true,
        currentRevision: true,
        milestone: {
          select: { programId: true, submissionType: true, dueAt: true },
        },
        application: {
          select: { status: true, repository: { select: { url: true } } },
        },
      },
    });
    if (!submission) return null;
    return {
      id: submission.id,
      applicationId: submission.applicationId,
      milestoneId: submission.milestoneId,
      programId: submission.milestone.programId,
      status: submission.status,
      currentRevision: submission.currentRevision,
      submissionType: submission.milestone.submissionType,
      applicationStatus: submission.application.status,
      repositoryUrl: submission.application.repository?.url ?? null,
      dueAt: submission.milestone.dueAt,
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
    // 상태·baseRevision을 조건으로 건 optimistic update —
    // 교직원 판정과 경합하거나 동시 교체가 끼어들면 count 0이 되어 stale로 끝난다.
    const updated = await this.database.submission.updateMany({
      where: {
        id: input.submissionId,
        status: input.baseStatus,
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
        select: { id: true, revision: true },
      });
      if (input.content.type === 'FILE') {
        if (input.fileExpiresAt === null) {
          throw new SubmissionFileUnavailableError();
        }
        const attached = await this.database.submissionFile.updateMany({
          where: {
            id: input.content.fileId,
            uploaderId: input.submittedById,
            applicationId: input.applicationId,
            milestoneId: input.milestoneId,
            lifecycle: SubmissionFileLifecycle.PENDING,
            submissionRevisionId: null,
            pendingExpiresAt: { gt: input.now },
          },
          data: {
            submissionRevisionId: revision.id,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            pendingExpiresAt: null,
            expiresAt: input.fileExpiresAt,
          },
        });
        if (attached.count !== 1) throw new SubmissionFileUnavailableError();
      }
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

  lockProgramEndAt(programId: string) {
    return this.store.lockProgramEndAt(programId);
  }

  createSubmission(
    input: CreateSubmissionInput,
    submittedById: string,
    now: Date,
    fileExpiresAt: Date | null,
  ) {
    return this.store.createSubmission(
      input,
      submittedById,
      now,
      fileExpiresAt,
    );
  }

  findChecklistApplication(programId: string, userId: string) {
    return this.store.findChecklistApplication(programId, userId);
  }

  listChecklistMilestones(programId: string, applicationId: string, now: Date) {
    return this.store.listChecklistMilestones(programId, applicationId, now);
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

type SelectedSubmissionMilestone = Prisma.MilestoneGetPayload<{
  select: typeof MILESTONE_SELECT;
}>;

function toSubmissionMilestone(
  milestone: SelectedSubmissionMilestone,
): SubmissionMilestone {
  return {
    id: milestone.id,
    programId: milestone.programId,
    name: milestone.name,
    dueAt: milestone.dueAt,
    submissionType: milestone.submissionType,
    instructions: milestone.instructions,
    programEndAt: milestone.program.endAt,
  };
}
