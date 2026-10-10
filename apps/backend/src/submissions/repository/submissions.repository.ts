import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { STUDENT_MEMBER_WHERE } from '../../prisma/user-profile-read';
import {
  AccountStatus,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionFileLifecycle,
  SubmissionStatus,
  type ApplicationStatus,
  type MilestoneSubmissionType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateSubmissionInput,
  SubmissionContentInput,
} from '../domain/submission-content';
import type {
  ChecklistMilestone,
  SubmissionApplication,
} from '../domain/submission-record';
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
import { lockSubmissionMembership } from '../../prisma/submission-membership-lock';
import { SubmissionMembershipChangedError } from '../domain/submission-membership-changed.error';
import {
  exactSubmissionByPublicId,
  publicSubmissionId,
  submissionPublicIdWhere,
} from '../domain/submission-public-id';

type SubmissionsDatabase = Prisma.TransactionClient;

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
  readonly programEndAt: Date;
}

export interface CreatedSubmission {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly submittedAt: Date;
}

export interface ChecklistApplication {
  readonly id: string;
  readonly teamId: string | null;

  readonly teamMemberCount: number;
  readonly status: ApplicationStatus;
}

export interface ResubmissionTarget {
  readonly id: string;

  readonly submissionRecordId: string;
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly programId: string;
  readonly status: SubmissionStatus;
  readonly currentRevision: number;
  readonly submissionType: MilestoneSubmissionType;
  readonly applicationStatus: ApplicationStatus;
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

class LegacySubmissionSlotMissingError extends Error {
  override readonly name = 'LegacySubmissionSlotMissingError';
}

const LEGACY_SUBMISSION_SLOT_SORT_ORDER = -1;

function legacySubmissionSlotIdFor(milestoneId: string): string {
  return `legacy_document_${createHash('md5').update(milestoneId).digest('hex')}`;
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
        ...STUDENT_MEMBER_WHERE,
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
      readonly { endAt: Date }[]
    >(Prisma.sql`
      SELECT "endAt"
      FROM "Program"
      WHERE "id" = ${programId}
      FOR UPDATE
    `);
    return programs[0]?.endAt ?? null;
  }

  private async legacySubmissionSlotId(milestoneId: string): Promise<string> {
    const existing = await this.findLegacySubmissionSlot(milestoneId);
    if (existing !== null) return existing;

    const milestone = await this.database.milestone.findFirst({
      where: { id: milestoneId },
      select: { name: true, createdAt: true, updatedAt: true },
    });
    if (milestone === null) throw new LegacySubmissionSlotMissingError();

    await this.database.$queryRaw(Prisma.sql`
      INSERT INTO "MilestoneDocument" (
        "id", "milestoneId", "name", "required", "sortOrder", "kind",
        "createdAt", "updatedAt"
      )
      VALUES (
        ${legacySubmissionSlotIdFor(milestoneId)},
        ${milestoneId},
        ${milestone.name},
        TRUE,
        ${LEGACY_SUBMISSION_SLOT_SORT_ORDER},
        ${MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION}::"MilestoneDocumentKind",
        ${milestone.createdAt},
        ${milestone.updatedAt}
      )
      ON CONFLICT DO NOTHING
    `);

    const created = await this.findLegacySubmissionSlot(milestoneId);
    if (created === null) throw new LegacySubmissionSlotMissingError();
    return created;
  }

  private async findLegacySubmissionSlot(
    milestoneId: string,
  ): Promise<string | null> {
    const document = await this.database.milestoneDocument.findFirst({
      where: {
        milestoneId,
        kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
      },
      select: { id: true },
    });
    return document?.id ?? null;
  }

  private async lockCurrentMembership(
    applicationId: string,
    actorUserId: string,
  ): Promise<void> {
    const stillMember = await lockSubmissionMembership(
      this.database,
      applicationId,
      actorUserId,
    );
    if (!stillMember) {
      throw new SubmissionMembershipChangedError(applicationId, actorUserId);
    }
  }

  async createSubmission(
    input: CreateSubmissionInput,
    submittedById: string,
    now: Date,
    fileExpiresAt: Date | null,
  ): Promise<CreatedSubmission> {
    await this.lockCurrentMembership(input.applicationId, submittedById);
    try {
      const documentId = await this.legacySubmissionSlotId(input.milestoneId);

      const submission = await this.database.milestoneDocumentSubmission.create(
        {
          data: {
            milestoneDocumentId: documentId,
            applicationId: input.applicationId,
            status: SubmissionStatus.SUBMITTED,
            content: submissionContentJson(input.content),
            revision: 1,
            submittedById,
            submittedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true, status: true, submittedAt: true },
        },
      );
      const history =
        await this.database.milestoneDocumentSubmissionHistory.create({
          data: {
            milestoneDocumentSubmissionId: submission.id,
            event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
            revision: 1,
            content: submissionContentJson(input.content),
            comment: input.comment,
            actorId: submittedById,
            createdAt: now,
          },
          select: { id: true },
        });

      if (input.content.type === 'FILE') {
        if (fileExpiresAt === null) throw new SubmissionFileUnavailableError();
        const attached = await this.database.submissionFile.updateMany({
          where: {
            id: input.content.fileId,
            uploaderId: submittedById,
            applicationId: input.applicationId,
            milestoneId: input.milestoneId,
            lifecycle: SubmissionFileLifecycle.PENDING,
            milestoneDocumentSubmissionId: null,
            milestoneDocumentSubmissionHistoryId: null,
            pendingExpiresAt: { gt: now },
          },
          data: {
            milestoneDocumentSubmissionId: submission.id,
            milestoneDocumentSubmissionHistoryId: history.id,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            pendingExpiresAt: null,
            expiresAt: fileExpiresAt,
          },
        });
        if (attached.count !== 1) throw new SubmissionFileUnavailableError();
      }

      return submission;
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
    return this.database.application
      .findFirst({
        where: { programId, ...submissionParticipantWhere(userId) },
        select: {
          id: true,
          teamId: true,
          team: { select: { _count: { select: { members: true } } } },
          status: true,
        },
      })
      .then((row) =>
        row === null
          ? null
          : {
              id: row.id,
              teamId: row.teamId,
              teamMemberCount: row.team?._count.members ?? 0,
              status: row.status,
            },
      );
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
    return milestones.flatMap((milestone) => {
      const item = toChecklistMilestone(milestone);
      return item === null ? [] : [item];
    });
  }

  async findSubmissionForParticipant(
    submissionId: string,
    userId: string,
  ): Promise<ResubmissionTarget | null> {
    const submissions =
      await this.database.milestoneDocumentSubmission.findMany({
        where: {
          ...submissionPublicIdWhere(submissionId),
          milestoneDocument: {
            kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
          },
          application: submissionParticipantWhere(userId),
        },
        take: 2,
        select: {
          id: true,
          legacySubmissionId: true,
          applicationId: true,
          status: true,
          revision: true,
          milestoneDocument: {
            select: {
              milestoneId: true,
              milestone: {
                select: {
                  programId: true,
                  submissionType: true,
                  dueAt: true,
                },
              },
            },
          },
          application: { select: { status: true } },
        },
      });
    const submission = exactSubmissionByPublicId(submissions);
    if (submission === null) return null;
    if (submission.milestoneDocument.milestone.submissionType === null) {
      return null;
    }
    return {
      id: publicSubmissionId(submission),
      submissionRecordId: submission.id,
      applicationId: submission.applicationId,
      milestoneId: submission.milestoneDocument.milestoneId,
      programId: submission.milestoneDocument.milestone.programId,
      status: submission.status,
      currentRevision: submission.revision,
      submissionType: submission.milestoneDocument.milestone.submissionType,
      applicationStatus: submission.application.status,
      dueAt: submission.milestoneDocument.milestone.dueAt,
    };
  }

  async submissionExists(submissionId: string): Promise<boolean> {
    const submission =
      await this.database.milestoneDocumentSubmission.findFirst({
        where: {
          ...submissionPublicIdWhere(submissionId),
          milestoneDocument: {
            kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
          },
        },
        select: { id: true },
      });
    return submission !== null;
  }

  async createSubmissionRevision(
    input: CreateSubmissionRevisionInput,
  ): Promise<{ readonly revision: number }> {
    await this.lockCurrentMembership(input.applicationId, input.submittedById);
    const nextRevision = input.baseRevision + 1;
    const updated = await this.database.milestoneDocumentSubmission.updateMany({
      where: {
        id: input.submissionId,
        status: input.baseStatus,
        revision: input.baseRevision,
      },
      data: {
        status: SubmissionStatus.SUBMITTED,
        revision: nextRevision,
        content: submissionContentJson(input.content),
        submittedById: input.submittedById,
        submittedAt: input.now,
        updatedAt: input.now,
      },
    });
    if (updated.count === 0) throw new StaleSubmissionRevisionError();

    const history =
      await this.database.milestoneDocumentSubmissionHistory.create({
        data: {
          milestoneDocumentSubmissionId: input.submissionId,
          event: MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
          revision: nextRevision,
          content: submissionContentJson(input.content),
          comment: input.comment,
          actorId: input.submittedById,
          createdAt: input.now,
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
          milestoneDocumentSubmissionId: null,
          milestoneDocumentSubmissionHistoryId: null,
          pendingExpiresAt: { gt: input.now },
        },
        data: {
          milestoneDocumentSubmissionId: input.submissionId,
          milestoneDocumentSubmissionHistoryId: history.id,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          pendingExpiresAt: null,
          expiresAt: input.fileExpiresAt,
        },
      });
      if (attached.count !== 1) throw new SubmissionFileUnavailableError();
    }
    return { revision: nextRevision };
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

function submissionContentJson(input: SubmissionContentInput) {
  return input.type === 'FILE' ? Prisma.JsonNull : input;
}

function toSubmissionMilestone(
  milestone: SelectedSubmissionMilestone,
): SubmissionMilestone | null {
  if (milestone.submissionType === null) return null;
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
