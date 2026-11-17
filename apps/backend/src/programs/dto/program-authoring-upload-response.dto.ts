import { type ProgramAuthoringUploadResponse } from '../files.error';

export class ProgramAuthoringUploadResponseDto {
  declare readonly id: string;
  declare readonly size: number;
  declare readonly expiresAt: string;

  static from(
    upload: ProgramAuthoringUploadResponse,
  ): ProgramAuthoringUploadResponseDto {
    return {
      id: upload.id,
      size: upload.size,
      expiresAt: upload.expiresAt,
    };
  }
}
