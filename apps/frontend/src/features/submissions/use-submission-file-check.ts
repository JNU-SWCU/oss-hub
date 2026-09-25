'use client';

import { ApiError } from '@/lib/api-client';
import type { SubmissionUploadLimit } from '@/lib/submission-upload-policy';
import { useFileCheck } from '@/lib/use-file-check';
import { checkSubmissionFile } from './api';
import {
  submissionFileCheckMessage,
  validateSubmissionFile,
} from './submission-form';

/**
 * #1108 — ZIP을 고르자마자 서버에 제출과 같은 판정을 묻는다. 예전에는 거절 사유를 보려면
 * 제출을 눌러야 했다. 규칙은 서버 한 곳이 소유하고 화면은 다시 적지 않는다.
 *
 * 제출은 바꾸지 않는다. 판정으로 제출을 막지 않고, 제출 때 같은 검사가 다시 돈다.
 * 판정이 아닌 실패(세션 만료·네트워크)는 아무 말도 붙이지 않는다 — 제출이 다시 만나 알린다.
 */
export function useSubmissionFileCheck(selectedFile: File | null) {
  const { start, checking, message } = useFileCheck(selectedFile);
  return {
    checking,
    message,
    start: (file: File | null, policy: SubmissionUploadLimit) =>
      start(
        file,
        file !== null &&
          file.name.toLowerCase().endsWith('.zip') &&
          validateSubmissionFile(file, policy).ok
          ? (picked) =>
              checkSubmissionFile(picked).then(
                () => null,
                (error: unknown) =>
                  error instanceof ApiError
                    ? submissionFileCheckMessage(error.problem, policy)
                    : null,
              )
          : undefined,
      ),
  };
}
