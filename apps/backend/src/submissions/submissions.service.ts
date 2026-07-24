import { Injectable } from '@nestjs/common';
import { ApplicationStatus, MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { programDeadline } from '../programs/program-deadline';
import type { CreateSubmissionInput } from './domain/submission-content';
import type {
  CreatedSubmissionResponseDto,
  SubmissionBlockedReasonResponseDto,
  SubmissionFormResponseDto,
} from './dto/submission-response.dto';
import { isLinkedRepositoryReleaseUrl } from './submission-release-url';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.enum';
import {
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

  private async requireStudent(
    store: Pick<SubmissionsStore, 'findActiveStudentByGithubId'>,
    githubId: bigint,
  ) {
    const actor = await store.findActiveStudentByGithubId(githubId);
    if (!actor) throw this.error(SubmissionsErrorCode.STUDENT_ONLY);
    return actor;
  }

  private requireApprovedApplication(
    application: SubmissionApplication | null,
  ): asserts application is SubmissionApplication {
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
