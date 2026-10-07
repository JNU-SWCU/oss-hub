'use client';

import { ApiError } from '@/lib/api-client';
import { useFileCheck } from '@/lib/use-file-check';
import { checkMilestoneDocumentFile } from './milestone-document-api';
import { isMilestoneDocumentArchiveErrorCode } from './milestone-document-upload-policy';

export function useMilestoneDocumentFileCheck(selectedFile: File | null) {
  const { start, checking, message } = useFileCheck(selectedFile);
  return {
    checking,
    message,

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
