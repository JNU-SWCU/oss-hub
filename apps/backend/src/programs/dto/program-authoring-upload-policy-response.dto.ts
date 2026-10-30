import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../submission-file.policy';

export class ProgramAuthoringUploadPolicyResponseDto {
  readonly fileUpload = {
    maxBytes: SUBMISSION_UPLOAD_MAX_BYTES,
    maxLabel: SUBMISSION_UPLOAD_MAX_LABEL,
  };
}
