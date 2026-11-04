import { SUBMISSION_REVIEW_EVENTS } from './submission-history.config';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { STUDENT_MEMBER_WHERE } from '../platform/user-profile-read.config';
import {
  AccountStatus,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  Prisma,
  SubmissionFileLifecycle,
  SubmissionStatus,
  type ApplicationStatus,
  MilestoneSubmissionType,
  type ReviewDecision,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import type { MilestoneDocumentSubmissionDetail } from './milestone-document-collection-read.repository';
import {
  MilestoneDocumentPendingFileMissingError,
  MilestoneDocumentReviewChangedError,
  MilestoneDocumentDeadlineClosedError,
  MilestoneDocumentSubmissionChangedError,
  MilestoneDocumentRevisionChangedError,
  MilestoneDocumentMissingError,
} from './milestone-document-submission.error';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import {
  SubmissionAlreadyExistsError,
  SubmissionFileUnavailableError,
  StaleSubmissionRevisionError,
  LegacySubmissionSlotMissingError,
  SubmissionPublicIdCollisionError,
} from './submissions.error';

export interface SubmissionApplication {
  readonly id: string;
  readonly programId: string;
  readonly teamId: string | null;

  readonly teamMemberCount: number;
  readonly status: ApplicationStatus;
  readonly existingSubmission: {
    readonly id: string;
    readonly status: SubmissionStatus;
  } | null;
}

interface ChecklistLatestReview {
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
}

type SubmissionFileRow = Omit<SubmissionFileMetadata, 'contentType'>;

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
    readonly file: SubmissionFileRow | null;
  } | null;
}

type ApplicationRecord = Prisma.ApplicationGetPayload<{
  select: ReturnType<SubmissionsRepository['submissionApplicationSelect']>;
}>;

const SUBMISSION_HISTORY_EVENTS: MilestoneDocumentSubmissionHistoryEvent[] = [
  MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
  MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
];

type ChecklistMilestoneRecord = Prisma.MilestoneGetPayload<{
  select: ReturnType<SubmissionsRepository['checklistMilestoneSelect']>;
}>;

type ChecklistTargetSubmission = NonNullable<
  ChecklistMilestoneRecord['documents'][number]['submissions'][number]
>;

function currentRevisionFile(
  submission: ChecklistTargetSubmission,
): SubmissionFileRow | null {
  const currentHistory =
    submission.histories.find(
      (history) =>
        SUBMISSION_HISTORY_EVENTS.includes(history.event) &&
        history.revision === submission.revision,
    ) ?? null;
  if (currentHistory?.revision !== submission.revision) return null;
  const file = currentHistory?.files[0] ?? null;
  if (file === null || file.expiresAt === null) return null;
  return {
    fileId: file.id,
    fileName: file.originalFileName,
    size: file.sizeBytes,
    expiresAt: file.expiresAt,
  };
}

export type SubmissionContentInput =
  | {
      readonly type: typeof MilestoneSubmissionType.FILE;
      readonly fileId: string;
    }
  | {
      readonly type: typeof MilestoneSubmissionType.TEXT;
      readonly text: string;
    };

export interface CreateSubmissionInput {
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly content: SubmissionContentInput;
  readonly comment: string | null;
}

export interface ResubmitSubmissionInput {
  readonly baseRevision: number;
  readonly content: SubmissionContentInput;
  readonly comment: string | null;
}

type SubmissionsDatabase = Prisma.TransactionClient;

interface SubmissionActor {
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

interface CreatedSubmission {
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

@Injectable()
export class SubmissionsRepository implements SubmissionsStore {
  private readonly store: SubmissionsStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {
    this.store = this.submissionsStore(prisma);
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
      operation(this.submissionsStore(transaction)),
    );
  }

  submissionParticipantWhere(userId: string): Prisma.ApplicationWhereInput {
    return this.platformRepository.programApplicationParticipantWhere(userId);
  }

  toSubmissionApplication(
    application: ApplicationRecord,
  ): SubmissionApplication {
    return {
      id: application.id,
      programId: application.programId,
      teamId: application.teamId,
      teamMemberCount: application.team._count.members,
      status: application.status,
      existingSubmission: application.milestoneDocumentSubmissions[0]
        ? {
            id: application.milestoneDocumentSubmissions[0].id,
            status: application.milestoneDocumentSubmissions[0].status,
          }
        : null,
    };
  }

  toChecklistMilestone(
    record: ChecklistMilestoneRecord,
  ): ChecklistMilestone | null {
    if (record.submissionType === null) return null;
    const submission = record.documents[0]?.submissions[0] ?? null;
    const review = submission?.histories.find((history) =>
      SUBMISSION_REVIEW_EVENTS.includes(history.event),
    );
    return {
      id: record.id,
      name: record.name,
      dueAt: record.dueAt,
      submissionType: record.submissionType,
      submission: submission
        ? {
            id: submission.id,
            status: submission.status,
            currentRevision: submission.revision,
            latestReview:
              review === undefined
                ? null
                : {
                    decision: submissionReviewDecision(review.event),
                    reviewedAt: review.createdAt,
                    comment: review.comment,
                  },
            file: currentRevisionFile(submission),
          }
        : null,
    };
  }

  submissionPublicIdWhere(publicId: string) {
    return { id: publicId };
  }

  exactSubmissionByPublicId<T>(rows: readonly T[]): T | null {
    if (rows.length > 1) {
      throw new SubmissionPublicIdCollisionError(
        'Ambiguous submission public id',
      );
    }
    return rows[0] ?? null;
  }

  readonly submissionApplicationSelect = (milestoneId: string) =>
    ({
      id: true,
      programId: true,
      teamId: true,

      team: { select: { _count: { select: { members: true } } } },
      status: true,
      milestoneDocumentSubmissions: {
        where: {
          milestoneDocument: {
            milestoneId,
            kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
          },
        },
        take: 1,
        select: { id: true, status: true },
      },
    }) as const;

  readonly checklistMilestoneOrderBy = [
    { dueAt: 'asc' as const },
    { createdAt: 'asc' as const },
  ];

  readonly checklistMilestoneSelect = (applicationId: string, now: Date) =>
    ({
      id: true,
      name: true,
      dueAt: true,
      submissionType: true,
      documents: {
        where: { kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION },
        take: 1,
        select: {
          submissions: {
            where: { applicationId },
            take: 1,
            select: {
              id: true,
              status: true,
              revision: true,

              histories: {
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: {
                  event: true,
                  createdAt: true,
                  comment: true,
                  revision: true,
                  files: {
                    where: {
                      lifecycle: SubmissionFileLifecycle.ATTACHED,
                      expiresAt: { gt: now },
                    },
                    orderBy: { id: 'asc' as const },
                    take: 1,
                    select: {
                      id: true,
                      originalFileName: true,
                      mimeType: true,
                      sizeBytes: true,
                      expiresAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    }) satisfies Prisma.MilestoneSelect;

  private submissionsStore(database: SubmissionsDatabase): SubmissionsStore {
    return {
      findActiveStudentByGithubId: this.findActiveStudentByGithubIdIn.bind(
        this,
        database,
      ),
      findMilestoneByProgram: this.findMilestoneByProgramIn.bind(
        this,
        database,
      ),
      findMilestoneById: this.findMilestoneByIdIn.bind(this, database),
      findParticipantApplication: this.findParticipantApplicationIn.bind(
        this,
        database,
      ),
      findApplicationForParticipant: this.findApplicationForParticipantIn.bind(
        this,
        database,
      ),
      lockProgramEndAt: this.lockProgramEndAtIn.bind(this, database),
      createSubmission: this.createSubmissionIn.bind(this, database),
      findChecklistApplication: this.findChecklistApplicationIn.bind(
        this,
        database,
      ),
      listChecklistMilestones: this.listChecklistMilestonesIn.bind(
        this,
        database,
      ),
      findSubmissionForParticipant: this.findSubmissionForParticipantIn.bind(
        this,
        database,
      ),
      submissionExists: this.submissionExistsIn.bind(this, database),
      createSubmissionRevision: this.createSubmissionRevisionIn.bind(
        this,
        database,
      ),
    };
  }

  private async findActiveStudentByGithubIdIn(
    database: SubmissionsDatabase,
    githubId: bigint,
  ): Promise<SubmissionActor | null> {
    return database.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: { id: true },
    });
  }

  private async findMilestoneByProgramIn(
    database: SubmissionsDatabase,
    programId: string,
    milestoneId: string,
  ): Promise<SubmissionMilestone | null> {
    const milestone = await database.milestone.findFirst({
      where: { id: milestoneId, programId },
      select: MILESTONE_SELECT,
    });
    return milestone ? toSubmissionMilestone(milestone) : null;
  }

  private async findMilestoneByIdIn(
    database: SubmissionsDatabase,
    milestoneId: string,
  ): Promise<SubmissionMilestone | null> {
    const milestone = await database.milestone.findUnique({
      where: { id: milestoneId },
      select: MILESTONE_SELECT,
    });
    return milestone ? toSubmissionMilestone(milestone) : null;
  }

  private async findParticipantApplicationIn(
    database: SubmissionsDatabase,
    programId: string,
    milestoneId: string,
    userId: string,
  ): Promise<SubmissionApplication | null> {
    const application = await database.application.findFirst({
      where: {
        programId,
        ...this.submissionParticipantWhere(userId),
      },
      select: this.submissionApplicationSelect(milestoneId),
    });
    return application ? this.toSubmissionApplication(application) : null;
  }

  private async findApplicationForParticipantIn(
    database: SubmissionsDatabase,
    applicationId: string,
    milestoneId: string,
    userId: string,
  ): Promise<SubmissionApplication | null> {
    const application = await database.application.findFirst({
      where: {
        id: applicationId,
        ...this.submissionParticipantWhere(userId),
      },
      select: this.submissionApplicationSelect(milestoneId),
    });
    return application ? this.toSubmissionApplication(application) : null;
  }

  private async lockProgramEndAtIn(
    database: SubmissionsDatabase,
    programId: string,
  ): Promise<Date | null> {
    const programs = await database.$queryRaw<
      readonly { endAt: Date }[]
    >(Prisma.sql`
      SELECT "endAt"
      FROM "Program"
      WHERE "id" = ${programId} AND "lifecycle" <> 'DELETED'
      FOR UPDATE
    `);
    return programs[0]?.endAt ?? null;
  }

  private async legacySubmissionSlotIdIn(
    database: SubmissionsDatabase,
    milestoneId: string,
  ): Promise<string> {
    const existing = await this.findLegacySubmissionSlotIn(
      database,
      milestoneId,
    );
    if (existing !== null) return existing;

    const milestone = await database.milestone.findFirst({
      where: { id: milestoneId },
      select: { name: true, createdAt: true, updatedAt: true },
    });
    if (milestone === null) throw new LegacySubmissionSlotMissingError();

    await database.$queryRaw(Prisma.sql`
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

    const created = await this.findLegacySubmissionSlotIn(
      database,
      milestoneId,
    );
    if (created === null) throw new LegacySubmissionSlotMissingError();
    return created;
  }

  private async findLegacySubmissionSlotIn(
    database: SubmissionsDatabase,
    milestoneId: string,
  ): Promise<string | null> {
    const document = await database.milestoneDocument.findFirst({
      where: {
        milestoneId,
        kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
      },
      select: { id: true },
    });
    return document?.id ?? null;
  }

  private async lockCurrentMembershipIn(
    database: SubmissionsDatabase,
    applicationId: string,
    actorUserId: string,
  ): Promise<void> {
    const stillMember = await this.platformRepository.lockSubmissionMembership(
      database,
      applicationId,
      actorUserId,
    );
    if (!stillMember) {
      throw new SubmissionMembershipChangedError(applicationId, actorUserId);
    }
  }

  private async createSubmissionIn(
    database: SubmissionsDatabase,
    input: CreateSubmissionInput,
    submittedById: string,
    now: Date,
    fileExpiresAt: Date | null,
  ): Promise<CreatedSubmission> {
    await this.lockCurrentMembershipIn(
      database,
      input.applicationId,
      submittedById,
    );
    try {
      const documentId = await this.legacySubmissionSlotIdIn(
        database,
        input.milestoneId,
      );

      const submission = await database.milestoneDocumentSubmission.create({
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
      });
      const history = await database.milestoneDocumentSubmissionHistory.create({
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
        const attached = await database.submissionFile.updateMany({
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

  private findChecklistApplicationIn(
    database: SubmissionsDatabase,
    programId: string,
    userId: string,
  ): Promise<ChecklistApplication | null> {
    return database.application
      .findFirst({
        where: {
          programId,
          ...this.submissionParticipantWhere(userId),
        },
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

  private async listChecklistMilestonesIn(
    database: SubmissionsDatabase,
    programId: string,
    applicationId: string,
    now: Date,
  ): Promise<readonly ChecklistMilestone[]> {
    const milestones = await database.milestone.findMany({
      where: { programId },
      orderBy: this.checklistMilestoneOrderBy,
      select: this.checklistMilestoneSelect(applicationId, now),
    });
    return milestones.flatMap((milestone) => {
      const item = this.toChecklistMilestone(milestone);
      return item === null ? [] : [item];
    });
  }

  private async findSubmissionForParticipantIn(
    database: SubmissionsDatabase,
    submissionId: string,
    userId: string,
  ): Promise<ResubmissionTarget | null> {
    const submissions = await database.milestoneDocumentSubmission.findMany({
      where: {
        ...this.submissionPublicIdWhere(submissionId),
        milestoneDocument: {
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
        application: this.submissionParticipantWhere(userId),
      },
      take: 2,
      select: {
        id: true,
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
    const submission = this.exactSubmissionByPublicId(submissions);
    if (submission === null) return null;
    if (submission.milestoneDocument.milestone.submissionType === null) {
      return null;
    }
    return {
      id: submission.id,
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

  private async submissionExistsIn(
    database: SubmissionsDatabase,
    submissionId: string,
  ): Promise<boolean> {
    const submission = await database.milestoneDocumentSubmission.findFirst({
      where: {
        ...this.submissionPublicIdWhere(submissionId),
        milestoneDocument: {
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
      },
      select: { id: true },
    });
    return submission !== null;
  }

  private async createSubmissionRevisionIn(
    database: SubmissionsDatabase,
    input: CreateSubmissionRevisionInput,
  ): Promise<{ readonly revision: number }> {
    await this.lockCurrentMembershipIn(
      database,
      input.applicationId,
      input.submittedById,
    );
    const nextRevision = input.baseRevision + 1;
    const updated = await database.milestoneDocumentSubmission.updateMany({
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

    const history = await database.milestoneDocumentSubmissionHistory.create({
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
      const attached = await database.submissionFile.updateMany({
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

type SelectedSubmissionMilestone = Prisma.MilestoneGetPayload<{
  select: typeof MILESTONE_SELECT;
}>;

@Injectable()
export class MilestoneDocumentSubmissionRepository {
  constructor(private readonly platformRepository: PlatformRepository) {}

  nextHistoryCreatedAt(requested: Date, latest: Date | null): Date {
    return latest === null || requested.getTime() > latest.getTime()
      ? requested
      : new Date(latest.getTime() + 1);
  }

  milestoneDocumentSubmissionContent(
    text: string | null,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return text === null
      ? Prisma.JsonNull
      : { type: MilestoneSubmissionType.TEXT, text };
  }

  upsertMilestoneDocumentSubmission(
    prisma: PrismaService,
    input: UpsertMilestoneDocumentSubmissionInput,
  ): Promise<MilestoneDocumentSubmissionDetail> {
    return prisma.$transaction(async (transaction) => {
      const stillMember =
        await this.platformRepository.lockSubmissionMembership(
          transaction,
          input.applicationId,
          input.submittedById,
        );
      if (!stillMember) {
        throw new SubmissionMembershipChangedError(
          input.applicationId,
          input.submittedById,
        );
      }

      let afterDeadline = false;
      if (input.deadline !== undefined) {
        const milestone = await transaction.$queryRaw<
          readonly { dueAt: Date }[]
        >(
          Prisma.sql`
          SELECT "dueAt"
          FROM "Milestone"
          WHERE "id" = ${input.deadline.milestoneId}
          FOR SHARE
        `,
        );
        const dueAt = milestone[0]?.dueAt;
        afterDeadline =
          dueAt !== undefined && input.submittedAt.getTime() > dueAt.getTime();
      }
      const documents = await transaction.$queryRaw<
        readonly { id: string; graceDueAt: Date | null }[]
      >(
        Prisma.sql`
      SELECT "id", "graceDueAt"
      FROM "MilestoneDocument"
      WHERE "id" = ${input.milestoneDocumentId}
      FOR UPDATE
    `,
      );
      const document = documents[0];
      if (document === undefined) throw new MilestoneDocumentMissingError();
      if (
        afterDeadline &&
        input.deadline !== undefined &&
        !input.deadline.allowAfterDeadline &&
        !(
          input.expectedLatestReviewId === null &&
          document.graceDueAt != null &&
          input.submittedAt.getTime() <= document.graceDueAt.getTime()
        )
      ) {
        throw new MilestoneDocumentDeadlineClosedError();
      }
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "MilestoneDocumentSubmission"
        WHERE "milestoneDocumentId" = ${input.milestoneDocumentId}
          AND "applicationId" = ${input.applicationId}
        FOR UPDATE
      `);
      const latestHistory =
        await transaction.milestoneDocumentSubmissionHistory.findFirst({
          where: {
            submission: {
              milestoneDocumentId: input.milestoneDocumentId,
              applicationId: input.applicationId,
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { createdAt: true },
        });
      const submittedAt = this.nextHistoryCreatedAt(
        input.submittedAt,
        latestHistory?.createdAt ?? null,
      );

      const latestReview =
        await transaction.milestoneDocumentSubmissionHistory.findFirst({
          where: {
            event: { in: SUBMISSION_REVIEW_EVENTS },
            submission: {
              milestoneDocumentId: input.milestoneDocumentId,
              applicationId: input.applicationId,
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
      if ((latestReview?.id ?? null) !== input.expectedLatestReviewId) {
        throw new MilestoneDocumentReviewChangedError();
      }

      if (
        input.expectedRevision !== undefined ||
        (afterDeadline && input.deadline !== undefined)
      ) {
        const current =
          await transaction.milestoneDocumentSubmission.findUnique({
            where: {
              milestoneDocumentId_applicationId: {
                milestoneDocumentId: input.milestoneDocumentId,
                applicationId: input.applicationId,
              },
            },
            select: { status: true, revision: true },
          });
        if (
          input.expectedRevision !== undefined &&
          (current?.revision ?? 0) !== input.expectedRevision
        ) {
          throw new MilestoneDocumentRevisionChangedError();
        }
        if (
          afterDeadline &&
          input.deadline !== undefined &&
          (current?.status ?? null) !== input.deadline.expectedSubmissionStatus
        )
          throw new MilestoneDocumentSubmissionChangedError();
      }

      const submission = await transaction.milestoneDocumentSubmission.upsert({
        where: {
          milestoneDocumentId_applicationId: {
            milestoneDocumentId: input.milestoneDocumentId,
            applicationId: input.applicationId,
          },
        },
        update: {
          status: SubmissionStatus.SUBMITTED,
          content: input.content,
          submittedById: input.submittedById,
          submittedAt,
          revision: { increment: 1 },
        },
        create: {
          milestoneDocumentId: input.milestoneDocumentId,
          applicationId: input.applicationId,
          status: SubmissionStatus.SUBMITTED,
          content: input.content,
          submittedById: input.submittedById,
          submittedAt,
        },
        select: {
          id: true,
          status: true,
          content: true,
          submittedAt: true,
          revision: true,
        },
      });

      const history =
        await transaction.milestoneDocumentSubmissionHistory.create({
          data: {
            milestoneDocumentSubmissionId: submission.id,
            event:
              submission.revision === 1
                ? MilestoneDocumentSubmissionHistoryEvent.SUBMITTED
                : MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
            revision: submission.revision,
            actorId: input.submittedById,
            content: input.content,
            createdAt: submittedAt,
            ...(input.comment === undefined ? {} : { comment: input.comment }),
          },
          select: { id: true },
        });

      if (input.attachFile !== null) {
        const attached = await transaction.submissionFile.updateMany({
          where: {
            id: input.attachFile.fileId,
            uploaderId: input.attachFile.uploaderId,
            applicationId: input.applicationId,
            milestoneId: input.attachFile.milestoneId,
            lifecycle: SubmissionFileLifecycle.PENDING,
            pendingExpiresAt: { gt: input.submittedAt },
          },
          data: {
            milestoneDocumentSubmissionId: submission.id,
            milestoneDocumentSubmissionHistoryId: history.id,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            pendingExpiresAt: null,
          },
        });
        if (attached.count !== 1) {
          throw new MilestoneDocumentPendingFileMissingError();
        }
      }

      const files = await transaction.submissionFile.findMany({
        where: {
          milestoneDocumentSubmissionHistoryId: history.id,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
        },
        orderBy: { createdAt: 'desc' },
        select: attachedFileSelect,
      });

      return {
        id: submission.id,
        status: submission.status,
        content: submission.content,
        submittedAt: submission.submittedAt,
        files,
      };
    });
  }
}

export interface UpsertMilestoneDocumentSubmissionInput {
  readonly milestoneDocumentId: string;
  readonly applicationId: string;
  readonly submittedById: string;
  readonly submittedAt: Date;
  readonly comment?: string | null;
  readonly expectedRevision?: number;
  readonly deadline?: {
    readonly milestoneId: string;
    readonly allowAfterDeadline: boolean;
    readonly expectedSubmissionStatus: SubmissionStatus | null;
  };
  readonly expectedLatestReviewId: string | null;
  readonly content: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  readonly attachFile: {
    readonly fileId: string;
    readonly uploaderId: string;
    readonly milestoneId: string;
  } | null;
}

const attachedFileSelect = {
  id: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
} as const;

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

function submissionReviewDecision(event: string): ReviewDecision {
  if (
    event === 'APPROVED' ||
    event === 'REJECTED' ||
    event === 'CHANGES_REQUESTED'
  )
    return event;
  throw new TypeError('Expected a submission review event');
}
