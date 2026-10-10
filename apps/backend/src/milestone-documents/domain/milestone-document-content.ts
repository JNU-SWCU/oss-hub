import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';

export type MilestoneDocumentContentInput = {
  readonly text: string | null;
  readonly fileId: string | null;
};

export type MilestoneDocumentSubmittedContent = {
  readonly type: typeof MilestoneSubmissionType.TEXT;
  readonly text: string;
};

export function readMilestoneDocumentSubmittedContent(
  stored: unknown,
): MilestoneDocumentSubmittedContent | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const content = stored as Record<string, unknown>;
  switch (content.type) {
    case MilestoneSubmissionType.TEXT:
      return typeof content.text === 'string'
        ? { type: MilestoneSubmissionType.TEXT, text: content.text }
        : null;
    default:
      return null;
  }
}

export function parseMilestoneDocumentContent(input: {
  readonly fileId?: string;
  readonly text?: string;
}): MilestoneDocumentContentInput {
  const text = input.text?.trim() || null;
  const fileId = input.fileId?.trim() || null;
  if (text === null && fileId === null) throw contentRequired();
  return { text, fileId };
}

function contentRequired(): DomainException {
  return new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.CONTENT_REQUIRED
    ],
  );
}
