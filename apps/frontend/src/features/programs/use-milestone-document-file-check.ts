'use client';

import { ApiError } from '@/lib/api-client';
import { useFileCheck } from '@/lib/use-file-check';
import { checkMilestoneDocumentFile } from './milestone-document-api';
import { isMilestoneDocumentArchiveErrorCode } from './milestone-document-upload-policy';

/**
 * #1108 — 서류 화면도 ZIP을 고르자마자 업로드와 같은 판정을 묻는다(제출 화면과 같은 방식).
 * 이 화면은 서버가 한 말을 그대로 보이므로 판정 문장도 `detail` 그대로다.
 *
 * 파일 입력 옆에 세우는 것은 압축 내용 거절(MSD_037~044)뿐이다 — 제출 때 파일 입력으로
 * 옮겨 세우는 코드와 같은 목록이라 같은 문장이 두 자리에 뜨지 않는다. 그 밖의 실패(세션
 * 만료·네트워크)는 판정이 아니라서 말하지 않고, 제출 때 같은 검사가 다시 돈다. 제출 버튼도
 * 막지 않는다.
 */
export function useMilestoneDocumentFileCheck(selectedFile: File | null) {
  const { start, checking, message } = useFileCheck(selectedFile);
  return {
    checking,
    message,
    /** 형식·상한에서 이미 걸린 파일은 `null`로 넘긴다 — 그 사유는 화면이 먼저 말했다. */
    start: (file: File | null) =>
      start(
        file,
        file?.name.toLowerCase().endsWith('.zip')
          ? (picked) =>
              checkMilestoneDocumentFile(picked).then(
                () => null,
                (error: unknown) =>
                  error instanceof ApiError &&
                  isMilestoneDocumentArchiveErrorCode(error.problem.code)
                    ? error.problem.detail
                    : null,
              )
          : undefined,
      ),
  };
}
