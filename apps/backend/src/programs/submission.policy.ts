import {
  MilestoneSubmissionType,
  ApplicationStatus,
  SubmissionStatus,
} from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import { hasProgramDeadlinePassed } from './programs.policy';
import type { SubmissionApplication } from './submission.types';
import type { SubmissionBlockedReason } from './submission-result.policy';

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

export function parseSubmissionContent(input: {
  readonly type: string;
  readonly fileId?: string;
  readonly text?: string;
}): SubmissionContentInput {
  switch (input.type) {
    case MilestoneSubmissionType.FILE: {
      const fileId = input.fileId?.trim();
      if (!fileId) throw contentRequired();
      return { type: MilestoneSubmissionType.FILE, fileId };
    }
    case MilestoneSubmissionType.TEXT: {
      const text = input.text?.trim();
      if (!text) throw contentRequired();
      return { type: MilestoneSubmissionType.TEXT, text };
    }
    default:
      throw new DomainException(
        SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.CONTENT_TYPE_MISMATCH],
      );
  }
}

function contentRequired(): DomainException {
  return new DomainException(
    SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.CONTENT_REQUIRED],
  );
}

export interface SubmissionPublicIdentity {
  readonly id: string;
  readonly legacySubmissionId: string | null;
}

export class SubmissionPublicIdCollisionError extends Error {
  override readonly name = 'SubmissionPublicIdCollisionError';
}

export function publicSubmissionId(identity: SubmissionPublicIdentity): string {
  return identity.legacySubmissionId ?? identity.id;
}

export function submissionPublicIdWhere(publicId: string) {
  return { OR: [{ id: publicId }, { legacySubmissionId: publicId }] };
}

export function exactSubmissionByPublicId<T>(rows: readonly T[]): T | null {
  if (rows.length > 1) {
    throw new SubmissionPublicIdCollisionError(
      'Ambiguous submission public id',
    );
  }
  return rows[0] ?? null;
}

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
