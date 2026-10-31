import { Inject, Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  SubmissionStatus,
  MilestoneSubmissionType,
  type ReviewDecision,
} from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { SubmissionMembershipChangedError } from './submission-membership-changed.error';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import {
  SubmissionsRepository,
  type SubmissionsStore,
  ResubmitSubmissionInput,
  CreateSubmissionInput,
  type SubmissionApplication,
  type SubmissionFileMetadata,
  type ChecklistMilestone,
} from './submissions.repository';
import {
  StaleSubmissionRevisionError,
  SubmissionAlreadyExistsError,
  SubmissionFileUnavailableError,
} from './submissions.error';
import { ProgramRulesService } from './program-rules.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';

export type SubmissionBlockedReason =
  'SUBMISSION_ALREADY_EXISTS' | 'MILESTONE_CLOSED';

export interface SubmissionFormResult {
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly milestone: {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
    readonly dDay: number;
    readonly deadlineLabel: string;
    readonly submissionType: MilestoneSubmissionType;
    readonly instructions: string | null;
  };
  readonly existingSubmission: SubmissionApplication['existingSubmission'];
  readonly canSubmit: boolean;
  readonly blockedReason: SubmissionBlockedReason | null;
}

export interface CreatedSubmissionResult {
  readonly submissionId: string;
  readonly status: SubmissionStatus;
  readonly submittedAt: Date;
}

export interface ResubmittedSubmissionResult {
  readonly submissionId: string;
  readonly revision: number;
  readonly status: SubmissionStatus;
}

interface SubmissionChecklistItemResult {
  readonly milestoneId: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly submission: {
    readonly id: string;
    readonly status: SubmissionStatus;
    readonly currentRevision: number;
    readonly decision: ReviewDecision | null;
    readonly lastReviewedAt: Date | null;
    readonly reviewComment: string | null;
    readonly canResubmit: boolean;
    readonly file: SubmissionFileMetadata | null;
  } | null;
}

export interface SubmissionChecklistResult {
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly items: readonly SubmissionChecklistItemResult[];
}

interface SubmissionMilestone {
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
}

interface SubmissionRevisionState extends SubmissionMilestone {
  readonly currentRevision: number;
  readonly status: SubmissionStatus;
}

function requireApprovedApplication<
  T extends Pick<SubmissionApplication, 'status'>,
>(application: T | null): asserts application is T {
  if (!application)
    throw submissionError(SubmissionsErrorCode.NOT_APPLICATION_MEMBER);
  if (application.status !== ApplicationStatus.APPROVED) {
    throw submissionError(SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED);
  }
}

function submissionError(code: SubmissionsErrorCode): DomainException {
  return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
}

@Injectable()
export class SubmissionsService {
  constructor(
    @Inject(SubmissionsRepository)
    private readonly repository: Pick<
      SubmissionsRepository,
      keyof SubmissionsStore | 'withTransaction'
    >,
    private readonly programRulesService: ProgramRulesService,
    private readonly submissionFileRulesService: SubmissionFileRulesService,
  ) {}

  async form(
    githubId: bigint,
    programId: string,
    milestoneId: string,
    now: Date = new Date(),
  ): Promise<SubmissionFormResult> {
    const actor = await this.requireStudent(this.repository, githubId);
    const milestone = await this.repository.findMilestoneByProgram(
      programId,
      milestoneId,
    );
    if (!milestone) throw this.error(SubmissionsErrorCode.MILESTONE_NOT_FOUND);
    const application = await this.repository.findParticipantApplication(
      programId,
      milestoneId,
      actor.id,
    );
    requireApprovedApplication(application);

    const blockedReason = this.submissionBlockedReason(
      application,
      milestone,
      now,
    );
    const deadline = this.programRulesService.programDeadline(
      milestone.dueAt,
      now,
    );
    return {
      applicationId: application.id,
      applicationMode: application.teamMemberCount > 1 ? 'TEAM' : 'PERSONAL',
      milestone: {
        id: milestone.id,
        name: milestone.name,
        dueAt: milestone.dueAt,
        dDay: deadline.dDay,
        deadlineLabel: deadline.label,
        submissionType: milestone.submissionType,
        instructions: milestone.instructions,
      },
      existingSubmission: application.existingSubmission,
      canSubmit: blockedReason === null,
      blockedReason,
    };
  }

  async create(
    githubId: bigint,
    input: CreateSubmissionInput,
    now: Date = new Date(),
  ): Promise<CreatedSubmissionResult> {
    try {
      return await this.repository.withTransaction(async (store) => {
        const actor = await this.requireStudent(store, githubId);
        const milestone = await store.findMilestoneById(input.milestoneId);
        if (!milestone)
          throw this.error(SubmissionsErrorCode.MILESTONE_NOT_FOUND);
        const application = await store.findApplicationForParticipant(
          input.applicationId,
          input.milestoneId,
          actor.id,
        );
        requireApprovedApplication(application);
        if (application.programId !== milestone.programId)
          throw this.error(SubmissionsErrorCode.NOT_APPLICATION_MEMBER);
        this.assertSubmittable(application, milestone, input, now);

        let fileExpiresAt: Date | null = null;
        if (input.content.type === 'FILE') {
          const programEndAt = await store.lockProgramEndAt(
            milestone.programId,
          );
          if (programEndAt === null) {
            throw this.error(SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE);
          }
          fileExpiresAt =
            this.submissionFileRulesService.addOneCalendarYear(programEndAt);
        }

        const created = await store.createSubmission(
          input,
          actor.id,
          now,
          fileExpiresAt,
        );
        return {
          submissionId: created.id,
          status: created.status,
          submittedAt: created.submittedAt,
        };
      });
    } catch (error: unknown) {
      if (error instanceof SubmissionMembershipChangedError) {
        throw this.error(SubmissionsErrorCode.NOT_APPLICATION_MEMBER);
      }
      if (error instanceof SubmissionAlreadyExistsError) {
        throw this.error(SubmissionsErrorCode.SUBMISSION_ALREADY_EXISTS);
      }
      if (error instanceof SubmissionFileUnavailableError) {
        throw this.error(SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE);
      }
      throw error;
    }
  }

  async checklist(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<SubmissionChecklistResult> {
    const actor = await this.requireStudent(this.repository, githubId);
    const application = await this.repository.findChecklistApplication(
      programId,
      actor.id,
    );
    requireApprovedApplication(application);

    const milestones = await this.repository.listChecklistMilestones(
      programId,
      application.id,
      now,
    );
    return {
      applicationId: application.id,
      applicationMode: application.teamMemberCount > 1 ? 'TEAM' : 'PERSONAL',
      items: milestones.map((milestone) =>
        this.submissionChecklistItem(milestone, now),
      ),
    };
  }

  async resubmit(
    githubId: bigint,
    submissionId: string,
    input: ResubmitSubmissionInput,
    now: Date = new Date(),
  ): Promise<ResubmittedSubmissionResult> {
    try {
      return await this.repository.withTransaction(async (store) => {
        const actor = await this.requireStudent(store, githubId);
        let target = await store.findSubmissionForParticipant(
          submissionId,
          actor.id,
        );
        if (!target) {
          throw this.error(
            (await store.submissionExists(submissionId))
              ? SubmissionsErrorCode.NOT_APPLICATION_MEMBER
              : SubmissionsErrorCode.SUBMISSION_NOT_FOUND,
          );
        }
        if (target.applicationStatus !== ApplicationStatus.APPROVED) {
          throw this.error(SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED);
        }
        const baseStatus = target.status;
        let fileExpiresAt: Date | null = null;
        if (input.content.type === 'FILE') {
          const programEndAt = await store.lockProgramEndAt(target.programId);
          if (programEndAt === null) {
            throw this.error(SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE);
          }
          const lockedTarget = await store.findSubmissionForParticipant(
            submissionId,
            actor.id,
          );
          if (!lockedTarget) {
            throw this.error(
              (await store.submissionExists(submissionId))
                ? SubmissionsErrorCode.NOT_APPLICATION_MEMBER
                : SubmissionsErrorCode.SUBMISSION_NOT_FOUND,
            );
          }
          target = lockedTarget;
          fileExpiresAt =
            this.submissionFileRulesService.addOneCalendarYear(programEndAt);
        }

        if (target.applicationStatus !== ApplicationStatus.APPROVED) {
          throw this.error(SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED);
        }
        if (target.status !== baseStatus) {
          throw this.error(SubmissionsErrorCode.STALE_SUBMISSION_REVISION);
        }
        this.assertResubmittable(target, input, now);

        const created = await store.createSubmissionRevision({
          submissionId: target.submissionRecordId,
          applicationId: target.applicationId,
          milestoneId: target.milestoneId,
          baseRevision: input.baseRevision,
          baseStatus,
          content: input.content,
          comment: input.comment,
          submittedById: actor.id,
          fileExpiresAt,
          now,
        });
        return {
          submissionId: target.id,
          revision: created.revision,
          status: SubmissionStatus.SUBMITTED,
        };
      });
    } catch (error: unknown) {
      if (error instanceof SubmissionMembershipChangedError) {
        throw this.error(SubmissionsErrorCode.NOT_APPLICATION_MEMBER);
      }
      if (error instanceof StaleSubmissionRevisionError) {
        throw this.error(SubmissionsErrorCode.STALE_SUBMISSION_REVISION);
      }
      if (error instanceof SubmissionFileUnavailableError) {
        throw this.error(SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE);
      }
      throw error;
    }
  }

  private async requireStudent(
    store: Pick<SubmissionsStore, 'findActiveStudentByGithubId'>,
    githubId: bigint,
  ) {
    const actor = await store.findActiveStudentByGithubId(githubId);
    if (!actor) throw this.error(SubmissionsErrorCode.STUDENT_ONLY);
    return actor;
  }

  private error(code: SubmissionsErrorCode): DomainException {
    return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
  }

  private submissionChecklistItem(
    milestone: ChecklistMilestone,
    now: Date,
  ): SubmissionChecklistItemResult {
    return {
      milestoneId: milestone.id,
      name: milestone.name,
      dueAt: milestone.dueAt,
      submissionType: milestone.submissionType,
      submission: milestone.submission
        ? {
            id: milestone.submission.id,
            status: milestone.submission.status,
            currentRevision: milestone.submission.currentRevision,
            decision: milestone.submission.latestReview?.decision ?? null,
            lastReviewedAt:
              milestone.submission.latestReview?.reviewedAt ?? null,
            reviewComment: milestone.submission.latestReview?.comment ?? null,
            canResubmit:
              milestone.submission.status ===
                SubmissionStatus.CHANGES_REQUESTED ||
              (milestone.submission.status === SubmissionStatus.SUBMITTED &&
                !this.programRulesService.hasProgramDeadlinePassed(
                  milestone.dueAt,
                  now,
                )),
            file: milestone.submission.file && {
              ...milestone.submission.file,
              contentType:
                this.submissionFileRulesService.safeSubmissionFileContentType(
                  milestone.submission.file.fileName,
                ),
            },
          }
        : null,
    };
  }

  private assertResubmittable(
    target: SubmissionRevisionState,
    input: ResubmitSubmissionInput,
    now: Date,
  ): void {
    if (input.baseRevision !== target.currentRevision)
      throw submissionError(SubmissionsErrorCode.STALE_SUBMISSION_REVISION);
    if (
      target.status === SubmissionStatus.REJECTED ||
      target.status === SubmissionStatus.APPROVED
    )
      throw submissionError(SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED);
    if (
      target.status !== SubmissionStatus.CHANGES_REQUESTED &&
      this.programRulesService.hasProgramDeadlinePassed(target.dueAt, now)
    ) {
      throw submissionError(SubmissionsErrorCode.SUBMISSION_REPLACEMENT_CLOSED);
    }
    if (input.content.type !== target.submissionType)
      throw submissionError(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
  }

  private submissionBlockedReason(
    application: SubmissionApplication,
    milestone: SubmissionMilestone,
    now: Date,
  ): SubmissionBlockedReason | null {
    if (application.existingSubmission) return 'SUBMISSION_ALREADY_EXISTS';
    if (this.programRulesService.hasProgramDeadlinePassed(milestone.dueAt, now))
      return 'MILESTONE_CLOSED';
    return null;
  }

  private assertSubmittable(
    application: SubmissionApplication,
    milestone: SubmissionMilestone,
    input: CreateSubmissionInput,
    now: Date,
  ): void {
    if (application.existingSubmission)
      throw submissionError(SubmissionsErrorCode.SUBMISSION_ALREADY_EXISTS);
    if (this.programRulesService.hasProgramDeadlinePassed(milestone.dueAt, now))
      throw submissionError(SubmissionsErrorCode.MILESTONE_CLOSED);
    if (input.content.type !== milestone.submissionType)
      throw submissionError(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
  }
}
