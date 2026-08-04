import type { Prisma, SubmissionStatus } from '@prisma/client';
import type { MilestoneDocumentSubmissionDetail } from '../milestone-documents.repository';

export class MilestoneDocumentSubmissionFileResponseDto {
  id: string;
  fileName: string;
  contentType: string;
  size: number;

  private constructor(id: string, fileName: string, contentType: string, size: number) {
    this.id = id;
    this.fileName = fileName;
    this.contentType = contentType;
    this.size = size;
  }

  static from(file: {
    readonly id: string;
    readonly originalFileName: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }): MilestoneDocumentSubmissionFileResponseDto {
    return new MilestoneDocumentSubmissionFileResponseDto(
      file.id,
      file.originalFileName,
      file.mimeType,
      file.sizeBytes,
    );
  }
}

/** `POST /milestones/:milestoneId/documents/:documentId/submissions` 응답. */
export class MilestoneDocumentSubmissionResponseDto {
  id: string;
  status: SubmissionStatus;
  content: Prisma.JsonValue | null;
  submittedAt: string;
  files: MilestoneDocumentSubmissionFileResponseDto[];

  private constructor(detail: MilestoneDocumentSubmissionDetail) {
    this.id = detail.id;
    this.status = detail.status;
    this.content = detail.content;
    this.submittedAt = detail.submittedAt.toISOString();
    this.files = detail.files.map((file) =>
      MilestoneDocumentSubmissionFileResponseDto.from(file),
    );
  }

  static from(
    detail: MilestoneDocumentSubmissionDetail,
  ): MilestoneDocumentSubmissionResponseDto {
    return new MilestoneDocumentSubmissionResponseDto(detail);
  }
}
