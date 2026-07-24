import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  MilestoneSubmissionType,
  SubmissionStatus,
} from '@prisma/client';
import { DomainException } from '../common/error-code';
import { programDeadline } from '../programs/program-deadline';
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
      applicationMode: application.teamId ? 'TEAM' : 'PERSONAL',
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

        const created = await store.createSubmission(input, actor.id);
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
      throw error;
    }
  }

  async checklist(
    githubId: bigint,
    programId: string,
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
    );
    return {
      applicationId: application.id,
      applicationMode: application.teamId ? 'TEAM' : 'PERSONAL',
      items: milestones.map((milestone) => this.toChecklistItem(milestone)),
    };
  }

  async resubmit(
    githubId: bigint,
    submissionId: string,
    input: ResubmitSubmissionInput,
  ): Promise<ResubmittedSubmissionResponseDto> {
    try {
      return await this.repository.withTransaction(async (store) => {
        const actor = await this.requireStudent(store, githubId);
        const target = await store.findSubmissionForParticipant(
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
        this.assertResubmittable(target, input);

        const created = await store.createSubmissionRevision({
          submissionId: target.id,
          baseRevision: input.baseRevision,
          content: input.content,
          comment: input.comment,
          submittedById: actor.id,
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
      throw error;
    }
  }

  private toChecklistItem(
    milestone: ChecklistMilestone,
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
            lastReviewedAt:
              milestone.submission.latestReview?.reviewedAt.toISOString() ??
              null,
            reviewComment: milestone.submission.latestReview?.comment ?? null,
            canResubmit:
              milestone.submission.status ===
              SubmissionStatus.CHANGES_REQUESTED,
          }
        : null,
    };
  }

  /**
   * 재제출 규칙(#116) — 최신 상태 CHANGES_REQUESTED만 허용하고 dueAt은 검사하지
   * 않는다(보완 재제출은 마감 후에도 허용). 내용 검증은 #115와 동일하다.
   */
  private assertResubmittable(
    target: ResubmissionTarget,
    input: ResubmitSubmissionInput,
  ): void {
    if (target.status !== SubmissionStatus.CHANGES_REQUESTED)
      throw this.error(SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED);
    if (input.baseRevision !== target.currentRevision)
      throw this.error(SubmissionsErrorCode.STALE_SUBMISSION_REVISION);
    if (input.content.type !== target.submissionType)
      throw this.error(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
    if (target.submissionType === MilestoneSubmissionType.FILE)
      throw this.error(SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE);
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
    if (now > milestone.dueAt) return 'MILESTONE_CLOSED';
    if (milestone.submissionType === MilestoneSubmissionType.FILE)
      return 'FILE_UPLOAD_UNAVAILABLE';
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
    if (now > milestone.dueAt)
      throw this.error(SubmissionsErrorCode.MILESTONE_CLOSED);
    if (input.content.type !== milestone.submissionType)
      throw this.error(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
    if (milestone.submissionType === MilestoneSubmissionType.FILE)
      throw this.error(SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE);
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
