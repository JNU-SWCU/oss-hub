'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  deleteAuthoringUpload,
  uploadProgramCover,
} from './program-authoring-api';
import {
  cleanupPreparedUploads,
  createProgramSubmissionRuntime,
  preparePendingUploads,
} from './program-authoring-submit';

export function useProgramCoverEdit() {
  const [selection, setSelection] = useState<File | null | undefined>();
  const runtime = useRef(createProgramSubmissionRuntime());

  useEffect(() => {
    const current = runtime.current;
    return () => {
      void cleanupPreparedUploads({
        runtime: current,
        localIds: ['program-cover'],
        deleteUpload: deleteAuthoringUpload,
      });
    };
  }, []);

  const change = (file: File | null | undefined) => {
    const previous = runtime.current.uploads.get('program-cover');
    runtime.current.uploads.delete('program-cover');
    runtime.current.uploadFiles.delete('program-cover');
    if (previous) void Promise.allSettled([deleteAuthoringUpload(previous.id)]);
    setSelection(file);
  };

  const prepare = async (): Promise<
    | { readonly kind: 'ready'; readonly coverUploadId?: string | null }
    | { readonly kind: 'failure'; readonly message: string }
  > => {
    if (selection === undefined) return { kind: 'ready' };
    if (selection === null) return { kind: 'ready', coverUploadId: null };
    const failure = await preparePendingUploads({
      candidates: [{ localId: 'program-cover', file: selection }],
      runtime: runtime.current,
      api: {
        uploadFile: uploadProgramCover,
        deleteUpload: deleteAuthoringUpload,
      },
    });
    if (failure)
      return {
        kind: 'failure',
        message:
          '대표 이미지를 올리지 못했습니다. 선택한 이미지는 유지됩니다. 다시 저장해 주세요.',
      };
    return {
      kind: 'ready',
      coverUploadId: runtime.current.uploads.get('program-cover')?.id,
    };
  };

  const saved = () => {
    runtime.current.uploads.clear();
    runtime.current.uploadFiles.clear();
    setSelection(undefined);
  };

  const failed = (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    if (
      !error.problem.fieldErrors?.some(
        (field) =>
          field.field === 'coverUploadId' &&
          field.code === 'INVALID_UPLOAD_TOKEN',
      )
    )
      return;
    runtime.current.uploads.delete('program-cover');
    runtime.current.uploadFiles.delete('program-cover');
  };

  return { selection, change, prepare, saved, failed };
}
