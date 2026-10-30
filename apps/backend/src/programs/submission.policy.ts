import { ApplicationStatus, SubmissionStatus } from '@prisma/client';
import type { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { hasProgramDeadlinePassed } from './program-deadline.policy';
import type {
  CreateSubmissionInput,
  ResubmitSubmissionInput,
} from './submission-content.policy';
import type { SubmissionApplication } from './submission-record.types';
import type { SubmissionBlockedReason } from './submission-result.policy';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';

interface SubmissionMilestone {
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
}

interface SubmissionRevisionState extends SubmissionMilestone {
  readonly currentRevision: number;
  readonly status: SubmissionStatus;
}

export function assertResubmittable(
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
    hasProgramDeadlinePassed(target.dueAt, now)
  ) {
    throw submissionError(SubmissionsErrorCode.SUBMISSION_REPLACEMENT_CLOSED);
  }
  if (input.content.type !== target.submissionType)
    throw submissionError(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
}

export function submissionBlockedReason(
  application: SubmissionApplication,
  milestone: SubmissionMilestone,
  now: Date,
): SubmissionBlockedReason | null {
  if (application.existingSubmission) return 'SUBMISSION_ALREADY_EXISTS';
  if (hasProgramDeadlinePassed(milestone.dueAt, now)) return 'MILESTONE_CLOSED';
  return null;
}

export function assertSubmittable(
  application: SubmissionApplication,
  milestone: SubmissionMilestone,
  input: CreateSubmissionInput,
  now: Date,
): void {
  if (application.existingSubmission)
    throw submissionError(SubmissionsErrorCode.SUBMISSION_ALREADY_EXISTS);
  if (hasProgramDeadlinePassed(milestone.dueAt, now))
    throw submissionError(SubmissionsErrorCode.MILESTONE_CLOSED);
  if (input.content.type !== milestone.submissionType)
    throw submissionError(SubmissionsErrorCode.CONTENT_TYPE_MISMATCH);
}

export function requireApprovedApplication<
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
