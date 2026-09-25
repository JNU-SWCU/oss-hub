'use client';

import { ApiError } from '@/lib/api-client';
import { useFileCheck } from '@/lib/use-file-check';
import { checkMilestoneDocumentFile } from './milestone-document-api';

/**
 * #1108 — 서류 화면도 ZIP을 고르자마자 업로드와 같은 판정을 묻는다(제출 화면과 같은 방식).
 * 이 화면은 서버가 한 말을 그대로 보이므로 판정 문장도 `detail` 그대로다.
 *
 * 서류 경로의 파일 판정은 모두 `MSD_*`로 온다. 그 밖의 실패(세션 만료·네트워크)는 판정이
 * 아니라서 아무 말도 붙이지 않는다 — 제출 때 같은 검사가 다시 돌고, 제출 버튼도 막지 않는다.
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
                  error.problem.code.startsWith('MSD_')
                    ? error.problem.detail
                    : null,
              )
          : undefined,
      ),
  };
}
