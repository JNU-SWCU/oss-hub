import {
  SUBMISSION_UPLOAD_ACCEPT,
  SUBMISSION_UPLOAD_FORMAT_LABEL,
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../../submissions/submission-upload-policy';
import { MilestoneDocumentResponseDto } from './milestone-document-response.dto';

export class MilestoneDocumentUploadPolicyResponseDto {
  maxBytes: number;

  maxLabel: string;

  accept: string;

  formatLabel: string;

  private constructor() {
    this.maxBytes = SUBMISSION_UPLOAD_MAX_BYTES;
    this.maxLabel = SUBMISSION_UPLOAD_MAX_LABEL;
    this.accept = SUBMISSION_UPLOAD_ACCEPT;
    this.formatLabel = SUBMISSION_UPLOAD_FORMAT_LABEL;
  }

  static current(): MilestoneDocumentUploadPolicyResponseDto {
    return new MilestoneDocumentUploadPolicyResponseDto();
  }
}

export class MilestoneDocumentListResponseDto {
  documents: MilestoneDocumentResponseDto[];
  fileUpload: MilestoneDocumentUploadPolicyResponseDto;

  private constructor(documents: MilestoneDocumentResponseDto[]) {
    this.documents = documents;
    this.fileUpload = MilestoneDocumentUploadPolicyResponseDto.current();
  }

  static from(
    documents: MilestoneDocumentResponseDto[],
  ): MilestoneDocumentListResponseDto {
    return new MilestoneDocumentListResponseDto(documents);
  }
}
