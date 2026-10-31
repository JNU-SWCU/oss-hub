import type { UploadedSubmissionFileResponse } from '../submission.types';

export class UploadedSubmissionFileResponseDto {
  declare readonly fileId: string;
  declare readonly fileName: string;
  declare readonly contentType: string;
  declare readonly size: number;
  declare readonly expiresAt: string;

  static from(
    file: UploadedSubmissionFileResponse,
  ): UploadedSubmissionFileResponseDto {
    return {
      fileId: file.fileId,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      expiresAt: file.expiresAt,
    };
  }
}
