import type { UploadedMilestoneDocumentFileResponse } from '../milestone-document-result.types';

export class UploadedMilestoneDocumentFileResponseDto {
  declare readonly fileId: string;
  declare readonly fileName: string;
  declare readonly contentType: string;
  declare readonly size: number;
  declare readonly expiresAt: string;

  static from(
    file: UploadedMilestoneDocumentFileResponse,
  ): UploadedMilestoneDocumentFileResponseDto {
    return {
      fileId: file.fileId,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      expiresAt: file.expiresAt,
    };
  }
}
