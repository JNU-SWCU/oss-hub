import type { ProgramAuthoringUploadResponse } from '../program-authoring-upload.error';

export class ProgramAuthoringUploadResponseDto {
  declare readonly id: string;
  declare readonly fileName: string;
  declare readonly contentType: string;
  declare readonly size: number;
  declare readonly expiresAt: string;

  static from(
    upload: ProgramAuthoringUploadResponse,
  ): ProgramAuthoringUploadResponseDto {
    return {
      id: upload.id,
      fileName: upload.fileName,
      contentType: upload.contentType,
      size: upload.size,
      expiresAt: upload.expiresAt,
    };
  }
}
