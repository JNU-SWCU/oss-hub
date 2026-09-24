'use client';

import { useCallback, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import type { SubmissionUploadLimit } from '@/lib/submission-upload-policy';
import { checkSubmissionFile } from './api';
import {
  submissionFileCheckMessage,
  validateSubmissionFile,
} from './submission-form';

type FileCheck =
  | { readonly file: File; readonly kind: 'checking' }
  | {
      readonly file: File;
      readonly kind: 'rejected';
      readonly message: string;
    };

/**
 * #1108 — ZIP을 고르자마자 서버에 제출과 같은 판정을 묻는다. 예전에는 거절 사유를 보려면
 * 제출을 눌러야 했다. 규칙은 서버 한 곳이 소유하고 화면은 다시 적지 않는다.
 *
 * 결과는 판정을 받은 **그 파일**에 묶인다. 다른 파일을 고르거나 선택이 비면 지난 결과는
 * 보이지 않는다 — 늦게 도착한 응답이 새로 고른 파일에 붙지 않는다.
 *
 * 제출은 바꾸지 않는다. 판정으로 제출을 막지 않고, 제출 때 같은 검사가 다시 돈다.
 * 판정이 아닌 실패(세션 만료·네트워크)는 아무 말도 붙이지 않는다 — 제출이 다시 만나 알린다.
 */
export function useSubmissionFileCheck(selectedFile: File | null) {
  const [check, setCheck] = useState<FileCheck | null>(null);

  const start = useCallback(
    (file: File | null, policy: SubmissionUploadLimit) => {
      if (
        file === null ||
        !file.name.toLowerCase().endsWith('.zip') ||
        !validateSubmissionFile(file, policy).ok
      ) {
        setCheck(null);
        return;
      }
      setCheck({ file, kind: 'checking' });
      const settle = (message: string | null) =>
        setCheck((current) =>
          current?.file !== file
            ? current
            : message === null
              ? null
              : { file, kind: 'rejected', message },
        );
      checkSubmissionFile(file).then(
        () => settle(null),
        (error: unknown) =>
          settle(
            error instanceof ApiError
              ? submissionFileCheckMessage(error.problem, policy)
              : null,
          ),
      );
    },
    [],
  );

  const current = check?.file === selectedFile ? check : null;
  return {
    start,
    checking: current?.kind === 'checking',
    message: current?.kind === 'rejected' ? current.message : null,
  };
}
