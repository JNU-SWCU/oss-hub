import { MilestoneSubmissionType } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../milestone-documents-error-code.enum';

/** MilestoneDocumentSubmission.content(Json)에 저장되는 TEXT 응답 shape. */
export type MilestoneDocumentContentInput =
  | {
      readonly type: typeof MilestoneSubmissionType.FILE;
      readonly fileId: string;
    }
  | {
      readonly type: typeof MilestoneSubmissionType.TEXT;
      readonly text: string;
    };

/**
 * 이미 저장된 제출 내용을 **읽어 낸** 모양 — 교직원 수합 표의 칸이 그대로 싣는다.
 *
 * `MilestoneDocumentContentInput`(들어오는 값)과 갈라 두는 이유: FILE은 저장 시점에
 * `Prisma.JsonNull`로 접히므로 나올 때는 존재하지 않는다. 들어오는 타입을 그대로 내보내면
 * 「파일 제출인데 content가 있다」는 불가능한 상태가 타입에 남는다.
 */
export type MilestoneDocumentSubmittedContent = {
  readonly type: typeof MilestoneSubmissionType.TEXT;
  readonly text: string;
};

/**
 * `MilestoneDocumentSubmission.content`(Json)에 저장된 값을 읽는다. 읽을 것이 없으면 null.
 *
 * **저장 모양의 원본은 `MilestoneDocumentsService.submit()`이다** — TEXT는 `{ type, text }`,
 * FILE은 `Prisma.JsonNull`을 쓴다. 여기서는 그 모양을 그대로 되꺼낼 뿐 새 규칙을 만들지 않는다.
 *
 * **판별은 서류 항목의 `submissionType`이 아니라 저장된 값의 `type`으로 한다.** 저장된 값이
 * 스스로 무엇인지 말하고 있는데 옆의 컬럼을 근거로 삼으면, 둘이 어긋나는 날 화면이 실제로 낸
 * 것과 다른 것을 보여 준다(교직원이 잘못된 근거로 승인한다).
 *
 * ⚠ **길이 상한을 두지 않는다 — 자르지 않고 그대로 싣는다.** 근거:
 * 1. 자르면 이 함수가 고치려는 결함이 그대로 돌아온다. 잘린 뒤를 읽을 방법이 지금 없기
 *    때문이다 — 교직원용 (서류, 신청) 단건 조회 endpoint가 없어서 프런트가 「더 보기」를 할
 *    곳이 없다. 「일부만 보고 승인」은 「못 보고 승인」과 같은 사고다.
 * 2. 한 칸의 크기는 이미 유계다. 제출 요청이 `text`를 10,000자로 막는다
 *    (`create-milestone-document-submission-request.dto.ts`). 상한을 다시 두어도
 *    그보다 큰 값은 애초에 저장되지 않는다.
 * 3. 남는 위험은 칸이 아니라 **페이지 크기**다 — 응답은 (행 수 × 서류 수)개의 칸을 싣고
 *    `pageSize`는 최대 100까지 열려 있다. TEXT 서류가 여러 개인 마일스톤에서 100행을 요청하면
 *    응답이 수 MB가 될 수 있다. 그때 고칠 자리는 이 함수가 아니라 **칸 단위 상세 조회를
 *    따로 내는 것**이다(그러면 표는 요약만 싣는다). 자르기는 그 endpoint가 생긴 뒤에야
 *    안전한 선택지가 된다.
 */
export function readMilestoneDocumentSubmittedContent(
  stored: unknown,
): MilestoneDocumentSubmittedContent | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const content = stored as Record<string, unknown>;
  switch (content.type) {
    case MilestoneSubmissionType.TEXT:
      return typeof content.text === 'string'
        ? { type: MilestoneSubmissionType.TEXT, text: content.text }
        : null;
    default:
      // FILE(저장 자체가 JsonNull)과 알 수 없는 모양은 「보여 줄 본문이 없다」로 접는다.
      return null;
  }
}

/** submissions/domain/submission-content.ts의 parseSubmissionContent와 같은 계약 — 이 모듈 전용 에러 코드만 다르다. */
export function parseMilestoneDocumentContent(input: {
  readonly type: string;
  readonly fileId?: string;
  readonly text?: string;
}): MilestoneDocumentContentInput {
  switch (input.type) {
    case MilestoneSubmissionType.FILE: {
      const fileId = input.fileId?.trim();
      if (!fileId) throw contentRequired();
      return { type: MilestoneSubmissionType.FILE, fileId };
    }
    case MilestoneSubmissionType.TEXT: {
      const text = input.text?.trim();
      if (!text) throw contentRequired();
      return { type: MilestoneSubmissionType.TEXT, text };
    }
    default:
      throw new DomainException(
        MILESTONE_DOCUMENTS_ERROR_CODES[
          MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH
        ],
      );
  }
}

function contentRequired(): DomainException {
  return new DomainException(
    MILESTONE_DOCUMENTS_ERROR_CODES[
      MilestoneDocumentsErrorCode.CONTENT_REQUIRED
    ],
  );
}
