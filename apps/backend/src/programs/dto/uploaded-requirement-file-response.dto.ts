import { type UploadedRequirementFileResponse } from '../files.config';

export class UploadedRequirementFileResponseDto {
  declare readonly fileId: string;
  declare readonly fileName: string;
  declare readonly contentType: string;
  declare readonly size: number;
  declare readonly expiresAt: string;

  static from(
    file: UploadedRequirementFileResponse,
  ): UploadedRequirementFileResponseDto {
    return {
      fileId: file.fileId,
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.size,
      expiresAt: file.expiresAt,
    };
  }
}
