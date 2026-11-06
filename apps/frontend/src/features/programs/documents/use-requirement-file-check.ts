'use client';

import { ApiError } from '@/lib/api-client';
import { useFileCheck } from '@/lib/use-file-check';
import { checkRequirementFile } from './requirement-api';
import { isRequirementArchiveErrorCode } from './requirement-upload-policy';

export function useRequirementFileCheck(selectedFile: File | null) {
  const { start, checking, message } = useFileCheck(selectedFile);
  return {
    checking,
    message,

    start: (file: File | null) =>
      start(
        file,
        file?.name.toLowerCase().endsWith('.zip')
          ? (picked) =>
              checkRequirementFile(picked).then(
                () => null,
                (error: unknown) =>
                  error instanceof ApiError &&
                  isRequirementArchiveErrorCode(error.problem.code)
                    ? error.problem.detail
                    : null,
              )
          : undefined,
      ),
  };
}
