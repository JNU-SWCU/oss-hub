import { Injectable } from '@nestjs/common';
import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import {
  SUBMISSIONS_ERROR_CODES,
  SubmissionsErrorCode,
} from './submissions-error-code.error';
import {
  SubmissionContentInput,
  ResubmitSubmissionInput,
  CreateSubmissionInput,
} from './submissions.repository';

@Injectable()
export class SubmissionInputService {
  parseSubmissionContent(input: {
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

  toCreateSubmissionInput(body: {
    readonly applicationId: string;
    readonly milestoneId: string;
    readonly content: Parameters<
      SubmissionInputService['parseSubmissionContent']
    >[0];
    readonly comment?: string;
  }): CreateSubmissionInput {
    return {
      applicationId: body.applicationId,
      milestoneId: body.milestoneId,
      content: this.parseSubmissionContent(body.content),
      comment: body.comment?.trim() || null,
    };
  }

  toResubmitSubmissionInput(body: {
    readonly baseRevision: number;
    readonly content: Parameters<
      SubmissionInputService['parseSubmissionContent']
    >[0];
    readonly comment?: string;
  }): ResubmitSubmissionInput {
    return {
      baseRevision: body.baseRevision,
      content: this.parseSubmissionContent(body.content),
      comment: body.comment?.trim() || null,
    };
  }
}

function contentRequired(): DomainException {
  return new DomainException(
    SUBMISSIONS_ERROR_CODES[SubmissionsErrorCode.CONTENT_REQUIRED],
  );
}
