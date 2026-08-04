import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../milestone-documents-error-code.enum';

/** MilestoneDocumentSubmission.content(Json)에 저장되는 TEXT/REPOSITORY_RELEASE 응답 shape. */
export type MilestoneDocumentContentInput =
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

/** submissions/domain/submission-content.ts의 parseSubmissionContent와 같은 계약 — 이 모듈 전용 에러 코드만 다르다. */
export function parseMilestoneDocumentContent(input: {
  readonly type: string;
  readonly fileId?: string;
  readonly text?: string;
  readonly releaseUrl?: string;
}): MilestoneDocumentContentInput {
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
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH
        ],
      );
  }
}

function contentRequired(): DomainException {
  return new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.CONTENT_REQUIRED
    ],
  );
}
