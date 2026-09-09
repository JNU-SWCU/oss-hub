import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../../submissions/submission-upload-policy';

export class ProgramAuthoringUploadPolicyResponseDto {
  readonly fileUpload = {
    maxBytes: SUBMISSION_UPLOAD_MAX_BYTES,
    maxLabel: SUBMISSION_UPLOAD_MAX_LABEL,
  };
}
