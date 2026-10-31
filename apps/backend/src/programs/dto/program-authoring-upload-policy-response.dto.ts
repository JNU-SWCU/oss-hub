import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../submission-upload.config';

export class ProgramAuthoringUploadPolicyResponseDto {
  declare readonly fileUpload: {
    readonly maxBytes: number;
    readonly maxLabel: string;
  };

  static from(): ProgramAuthoringUploadPolicyResponseDto {
    return {
      fileUpload: {
        maxBytes: SUBMISSION_UPLOAD_MAX_BYTES,
        maxLabel: SUBMISSION_UPLOAD_MAX_LABEL,
      },
    };
  }
}
