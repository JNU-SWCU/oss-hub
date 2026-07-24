import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from '../submissions-error-code.enum';

export type SubmissionContentInput =
  | {
      readonly type: typeof MilestoneSubmissionType.FILE;
      readonly fileId: string;
    }
  | {
      readonly type: typeof MilestoneSubmissionType.TEXT;
      readonly text: string;
    }
  | {
      readonly type: typeof MilestoneSubmissionType.REPOSITORY_RELEASE;
      readonly releaseUrl: string;
    };

export interface CreateSubmissionInput {
  readonly applicationId: string;
  readonly milestoneId: string;
  readonly content: SubmissionContentInput;
  readonly comment: string | null;
}

export function parseSubmissionContent(input: {
  readonly type: string;
  readonly fileId?: string;
  readonly text?: string;
  readonly releaseUrl?: string;
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
    case MilestoneSubmissionType.REPOSITORY_RELEASE: {
      const releaseUrl = input.releaseUrl?.trim();
      if (!releaseUrl) throw contentRequired();
      return {
        type: MilestoneSubmissionType.REPOSITORY_RELEASE,
        releaseUrl,
      };
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
