import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  MilestoneSubmissionType,
  SubmissionStatus,
} from '@prisma/client';
import { addOneCalendarYear } from '../common/add-one-calendar-year';
import { DomainException } from '../common/error-code';
import {
  hasProgramDeadlinePassed,
  programDeadline,
} from '../programs/program-deadline';
import type {
  CreateSubmissionInput,
  ResubmitSubmissionInput,
} from './domain/submission-content';
import type {
  CreatedSubmissionResponseDto,
  ResubmittedSubmissionResponseDto,
  SubmissionBlockedReasonResponseDto,
  SubmissionChecklistItemResponseDto,
  SubmissionChecklistResponseDto,
  SubmissionFormResponseDto,
} from './dto/submission-response.dto';
import { isLinkedRepositoryReleaseUrl } from './submission-release-url';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.enum';
import {
  type ChecklistMilestone,
  type ResubmissionTarget,
  StaleSubmissionRevisionError,
  SubmissionAlreadyExistsError,
  SubmissionFileUnavailableError,
  type SubmissionApplication,
  type SubmissionMilestone,
  SubmissionsRepository,
  type SubmissionsStore,
} from './submissions.repository';

@Injectable()
export class SubmissionsService {
  constructor(private readonly repository: SubmissionsRepository) {}

  async form(
    githubId: bigint,
    programId: string,
    milestoneId: string,
    now: Date = new Date(),
  ): Promise<SubmissionFormResponseDto> {
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
    this.requireApprovedApplication(application);

    const blockedReason = this.blockedReason(application, milestone, now);
    const deadline = programDeadline(milestone.dueAt, now);
    return {
      applicationId: application.id,
      applicationMode: application.teamMemberCount > 1 ? 'TEAM' : 'PERSONAL',
      milestone: {
        id: milestone.id,
        name: milestone.name,
        dueAt: milestone.dueAt.toISOString(),
        dDay: deadline.dDay,
        deadlineLabel: deadline.label,
        submissionType: milestone.submissionType,
        instructions: milestone.instructions,
      },
      repository:
        milestone.submissionType ===
          MilestoneSubmissionType.REPOSITORY_RELEASE &&
        application.repositoryUrl
          ? { url: application.repositoryUrl, status: 'READY' }
          : null,
      existingSubmission: application.existingSubmission
        ? {
            ...application.existingSubmission,
            checklistUrl: `/programs/${programId}/submissions?milestoneId=${milestoneId}`,
          }
        : null,
      canSubmit: blockedReason === null,
      blockedReason,
    };
  }

  async create(
    githubId: bigint,
    input: CreateSubmissionInput,
    now: Date = new Date(),
  ): Promise<CreatedSubmissionResponseDto> {
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
        this.requireApprovedApplication(application);
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
          fileExpiresAt = addOneCalendarYear(programEndAt);
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
          submittedAt: created.submittedAt.toISOString(),
        };
      });
    } catch (error: unknown) {
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
  ): Promise<SubmissionChecklistResponseDto> {
    const actor = await this.requireStudent(this.repository, githubId);
    const application = await this.repository.findChecklistApplication(
      programId,
      actor.id,
    );
    this.requireApprovedApplication(application);

    const milestones = await this.repository.listChecklistMilestones(
      programId,
      application.id,
      now,
    );
    return {
      applicationId: application.id,
      applicationMode: application.teamMemberCount > 1 ? 'TEAM' : 'PERSONAL',
      items: milestones.map((milestone) =>
        this.toChecklistItem(milestone, now),
      ),
    };
  }

  async resubmit(
    githubId: bigint,
    submissionId: string,
    input: ResubmitSubmissionInput,
    now: Date = new Date(),
  ): Promise<ResubmittedSubmissionResponseDto> {
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
          fileExpiresAt = addOneCalendarYear(programEndAt);
        }

        if (target.applicationStatus !== ApplicationStatus.APPROVED) {
          throw this.error(SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED);
        }
        if (target.status !== baseStatus) {
          throw this.error(SubmissionsErrorCode.STALE_SUBMISSION_REVISION);
        }
        this.assertResubmittable(target, input, now);

        const created = await store.createSubmissionRevision({
          submissionId: target.id,
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
      if (error instanceof StaleSubmissionRevisionError) {
        throw this.error(SubmissionsErrorCode.STALE_SUBMISSION_REVISION);
      }
      if (error instanceof SubmissionFileUnavailableError) {
        throw this.error(SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE);
      }
      throw error;
    }
  }

  private toChecklistItem(
    milestone: ChecklistMilestone,
    now: Date,
  ): SubmissionChecklistItemResponseDto {
    return {
      milestoneId: milestone.id,
      name: milestone.name,
      dueAt: milestone.dueAt.toISOString(),
      submissionType: milestone.submissionType,
      submission: milestone.submission
        ? {
            id: milestone.submission.id,
            status: milestone.submission.status,
            currentRevision: milestone.submission.currentRevision,
            decision: milestone.submission.latestReview?.decision ?? null,
            lastReviewedAt:
              milestone.submission.latestReview?.reviewedAt.toISOString() ??
              null,
            reviewComment: milestone.submission.latestReview?.comment ?? null,
            canResubmit:
              milestone.submission.status ===
                SubmissionStatus.CHANGES_REQUESTED ||
              (milestone.submission.status === SubmissionStatus.SUBMITTED &&
                !hasProgramDeadlinePassed(milestone.dueAt, now)),
            file: milestone.submission.file
              ? {
                  ...milestone.submission.file,
                  expiresAt: milestone.submission.file.expiresAt.toISOString(),
                }
              : null,
          }
        : null,
    };
  }

  /**
   * 보완 요청은 마감 후에도, 마감 전 교체는 최종 반려를 제외하고 허용한다.
   * 내용 검증은 #115와 동일하다.
   */
  private assertResubmittable(
    target: ResubmissionTarget,
    input: ResubmitSubmissionInput,
    now: Date,
  ): void {
    if (input.baseRevision !== target.currentRevision)
      throw this.error(SubmissionsErrorCode.STALE_SUBMISSION_REVISION);
    if (target.status === SubmissionStatus.REJECTED)
      throw this.error(SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED);
    // 승인된 제출물은 교체하지 않는다 — 교직원 판정이 옛 revision 을 가리킨 채 남는다.
    if (target.status === SubmissionStatus.APPROVED)
      throw this.error(SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED);
    if (
      target.status !== SubmissionStatus.CHANGES_REQUESTED &&
      hasProgramDeadlinePassed(target.dueAt, now)
    ) {
      throw this.error(SubmissionsErrorCode.SUBMISSION_REPLACEMENT_CLOSED);
    }
    if (input.content.type !== target.submissionType)
      throw this.error(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
    if (input.content.type === MilestoneSubmissionType.REPOSITORY_RELEASE) {
      if (!target.repositoryUrl)
        throw this.error(SubmissionsErrorCode.REPOSITORY_NOT_READY);
      if (
        !isLinkedRepositoryReleaseUrl(
          target.repositoryUrl,
          input.content.releaseUrl,
        )
      ) {
        throw this.error(
          SubmissionsErrorCode.RELEASE_URL_NOT_LINKED_REPOSITORY,
        );
      }
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

  private requireApprovedApplication<
    T extends Pick<SubmissionApplication, 'status'>,
  >(application: T | null): asserts application is T {
    if (!application)
      throw this.error(SubmissionsErrorCode.NOT_APPLICATION_MEMBER);
    if (application.status !== ApplicationStatus.APPROVED) {
      throw this.error(SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED);
    }
  }

  private blockedReason(
    application: SubmissionApplication,
    milestone: SubmissionMilestone,
    now: Date,
  ): SubmissionBlockedReasonResponseDto | null {
    if (application.existingSubmission) return 'SUBMISSION_ALREADY_EXISTS';
    if (hasProgramDeadlinePassed(milestone.dueAt, now))
      return 'MILESTONE_CLOSED';
    if (
      milestone.submissionType === MilestoneSubmissionType.REPOSITORY_RELEASE &&
      !application.repositoryUrl
    ) {
      return 'REPOSITORY_NOT_READY';
    }
    return null;
  }

  private assertSubmittable(
    application: SubmissionApplication,
    milestone: SubmissionMilestone,
    input: CreateSubmissionInput,
    now: Date,
  ): void {
    if (application.existingSubmission)
      throw this.error(SubmissionsErrorCode.SUBMISSION_ALREADY_EXISTS);
    if (hasProgramDeadlinePassed(milestone.dueAt, now))
      throw this.error(SubmissionsErrorCode.MILESTONE_CLOSED);
    if (input.content.type !== milestone.submissionType)
      throw this.error(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
    if (!application.repositoryUrl) {
      if (
        milestone.submissionType === MilestoneSubmissionType.REPOSITORY_RELEASE
      ) {
        throw this.error(SubmissionsErrorCode.REPOSITORY_NOT_READY);
      }
      return;
    }
    if (
      input.content.type === MilestoneSubmissionType.REPOSITORY_RELEASE &&
      !isLinkedRepositoryReleaseUrl(
        application.repositoryUrl,
        input.content.releaseUrl,
      )
    ) {
      throw this.error(SubmissionsErrorCode.RELEASE_URL_NOT_LINKED_REPOSITORY);
    }
  }

  private error(code: SubmissionsErrorCode): DomainException {
    return new DomainException(SUBMISSIONS_ERROR_CODES[code]);
  }
}
