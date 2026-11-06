import type { SubmissionStatus } from '@prisma/client';
import type { SubmissionDetail } from '../submissions.repository';

export class SubmissionFileResponseDto {
  declare readonly id: string;
  declare readonly fileName: string;
  declare readonly contentType: string;
  declare readonly size: number;

  static from(file: {
    readonly id: string;
    readonly originalFileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }): SubmissionFileResponseDto {
    return {
      id: file.id,
      fileName: file.originalFileName,
      contentType: file.mimeType,
      size: file.sizeBytes,
    };
  }
}

export class SubmissionResponseDto {
  declare readonly id: string;
  declare readonly status: SubmissionStatus;
  declare readonly content: SubmissionDetail['content'];
  declare readonly submittedAt: string;
  declare readonly files: SubmissionFileResponseDto[];

  static from(detail: SubmissionDetail): SubmissionResponseDto {
    return {
      id: detail.id,
      status: detail.status,
      content: detail.content,
      submittedAt: detail.submittedAt.toISOString(),
      files: detail.files.map((file) => SubmissionFileResponseDto.from(file)),
    };
  }
}
