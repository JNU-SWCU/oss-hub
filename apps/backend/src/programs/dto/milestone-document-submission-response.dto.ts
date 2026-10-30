import type { SubmissionStatus } from '@prisma/client';
import type { MilestoneDocumentSubmissionDetail } from '../milestone-document-result.types';

export class MilestoneDocumentSubmissionFileResponseDto {
  declare readonly id: string;
  declare readonly fileName: string;
  declare readonly contentType: string;
  declare readonly size: number;

  static from(file: {
    readonly id: string;
    readonly originalFileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }): MilestoneDocumentSubmissionFileResponseDto {
    return {
      id: file.id,
      fileName: file.originalFileName,
      contentType: file.mimeType,
      size: file.sizeBytes,
    };
  }
}

export class MilestoneDocumentSubmissionResponseDto {
  declare readonly id: string;
  declare readonly status: SubmissionStatus;
  declare readonly content: MilestoneDocumentSubmissionDetail['content'];
  declare readonly submittedAt: string;
  declare readonly files: MilestoneDocumentSubmissionFileResponseDto[];

  static from(
    detail: MilestoneDocumentSubmissionDetail,
  ): MilestoneDocumentSubmissionResponseDto {
    return {
      id: detail.id,
      status: detail.status,
      content: detail.content,
      submittedAt: detail.submittedAt.toISOString(),
      files: detail.files.map((file) =>
        MilestoneDocumentSubmissionFileResponseDto.from(file),
      ),
    };
  }
}
