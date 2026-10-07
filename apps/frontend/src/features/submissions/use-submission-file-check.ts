'use client';

import { ApiError } from '@/lib/api-client';
import type { SubmissionUploadLimit } from '@/lib/submission-upload-policy';
import { useFileCheck } from '@/lib/use-file-check';
import { checkSubmissionFile } from './api';
import {
  submissionFileCheckMessage,
  validateSubmissionFile,
} from './submission-form';

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
