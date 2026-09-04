import {
  SUBMISSION_UPLOAD_ACCEPT,
  SUBMISSION_UPLOAD_FORMAT_LABEL,
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../../submissions/submission-upload-policy';
import { MilestoneDocumentResponseDto } from './milestone-document-response.dto';

/**
 * 화면이 파일을 **고르기 전에** 읽는 업로드 규칙.
 *
 * 화면이 자기 사본을 들고 있으면 서버가 거절하는 상한과 화면이 약속하는 상한이 갈라진다 —
 * 실제로 갈라져서 이 티켓(#1107)이 났다. 그래서 숫자도 표기도 서버가 내려주고 화면은
 * 그대로 읽기만 한다. 이 응답 없이는 세 화면 어디에도 파일 입력이 그려지지 않으므로
 * 화면 쪽 기본값(fallback)이 필요 없다.
 */
export class MilestoneDocumentUploadPolicyResponseDto {
  /** 실제로 거절이 갈리는 경계. 5 MiB다(표기와 달리 1000 단위가 아니다). */
  maxBytes: number;
  /** 사람에게 보여 줄 표기. 「5 MB」로 통일한다. */
  maxLabel: string;
  /** `<input type="file" accept>`에 그대로 넣는 값. */
  accept: string;
  /** 「PDF, HWP, JPG, PNG, ZIP」 — 안내 문구에 그대로 쓴다. */
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

/**
 * `GET /milestones/:milestoneId/documents` 응답.
 *
 * ⚠ 항목 배열이 아니라 봉투다. 업로드 규칙은 서류 한 건의 속성이 아니라 이 마일스톤의
 * 업로드 입구 하나에 붙는 사실이라, 항목마다 같은 값을 복사해 싣지 않는다.
 */
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
