import { ApiError } from '@/lib/api-client';
import type { ProgramAuthoringUpload } from './program-authoring-api';
import { buildProgramAuthoringManifest } from './program-authoring-manifest';
import type { ProgramAuthoringState } from './program-authoring-model';

export interface ProgramAuthoringSubmitApi {
  readonly uploadCoverFile: (file: File) => Promise<ProgramAuthoringUpload>;
  readonly uploadFile: (file: File) => Promise<ProgramAuthoringUpload>;
  readonly deleteUpload: (uploadId: string) => Promise<void>;
  readonly createProgram: (
    manifest: ReturnType<typeof buildProgramAuthoringManifest>,
    idempotencyKey: string,
  ) => Promise<{ readonly id: string }>;
}

export interface ProgramSubmissionRuntime {
  submitting: boolean;
  readonly uploads: Map<string, ProgramAuthoringUpload>;
  readonly uploadFiles: Map<string, File>;
}

export type PendingUploadCandidate = {
  readonly localId: string;
  readonly file: File;
};

export type ProgramAuthoringSubmitResult =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'success'; readonly programId: string }
  | { readonly kind: 'conflict' }
  | {
      readonly kind: 'failure';
      readonly stage: 'upload' | 'aggregate';
      readonly message: string;
    };

export function createProgramSubmissionRuntime(): ProgramSubmissionRuntime {
  return { submitting: false, uploads: new Map(), uploadFiles: new Map() };
}

export async function submitProgramAuthoring(options: {
  readonly state: ProgramAuthoringState;
  readonly files: ReadonlyMap<string, File>;
  readonly runtime: ProgramSubmissionRuntime;
  readonly api: ProgramAuthoringSubmitApi;
}): Promise<ProgramAuthoringSubmitResult> {
  if (options.runtime.submitting) return { kind: 'ignored' };
  options.runtime.submitting = true;
  try {
    const uploadResult = await ensureUploads(options);
    if (uploadResult !== null) return uploadResult;
    const uploadIds = new Map(
      [...options.runtime.uploads].map(([requirementId, upload]) => [
        requirementId,
        upload.id,
      ]),
    );
    try {
      const program = await options.api.createProgram(
        buildProgramAuthoringManifest(options.state, uploadIds),
        options.state.idempotencyKey,
      );
      return { kind: 'success', programId: program.id };
    } catch (error: unknown) {
      if (error instanceof ApiError && error.problem.status === 409) {
        return { kind: 'conflict' };
      }
      return {
        kind: 'failure',
        stage: 'aggregate',
        message:
          '프로그램 생성에 실패했습니다. 같은 내용으로 다시 시도해 주세요.',
      };
    }
  } finally {
    options.runtime.submitting = false;
  }
}

export async function ensureUploads(options: {
  readonly state: ProgramAuthoringState;
  readonly files: ReadonlyMap<string, File>;
  readonly runtime: ProgramSubmissionRuntime;
  readonly api: ProgramAuthoringSubmitApi;
}): Promise<Extract<
  ProgramAuthoringSubmitResult,
  { readonly kind: 'failure' }
> | null> {
  if (options.state.coverFile) {
    const failure = await preparePendingUploads({
      candidates: [{ localId: 'program-cover', file: options.state.coverFile }],
      runtime: options.runtime,
      api: {
        uploadFile: options.api.uploadCoverFile,
        deleteUpload: options.api.deleteUpload,
      },
    });
    if (failure)
      return {
        ...failure,
        message:
          '대표 이미지를 올리지 못했습니다. 선택한 이미지는 유지되며 다시 시도할 수 있습니다.',
      };
  }
  const pending: PendingUploadCandidate[] = [];
  for (const milestone of options.state.milestones) {
    for (const requirement of milestone.requirements) {
      if (requirement.templateFile === null) continue;
      const file = options.files.get(requirement.id);
      if (file === undefined) {
        return {
          kind: 'failure',
          stage: 'upload',
          message: '파일 재선택 필요',
        };
      }
      pending.push({ localId: requirement.id, file });
    }
  }
  if (pending.length === 0) return null;

  const result = await preparePendingUploads({
    candidates: pending,
    runtime: options.runtime,
    api: options.api,
  });
  return result;
}

export async function preparePendingUploads(options: {
  readonly candidates: readonly PendingUploadCandidate[];
  readonly runtime: ProgramSubmissionRuntime;
  readonly api: Pick<ProgramAuthoringSubmitApi, 'uploadFile' | 'deleteUpload'>;
}): Promise<Extract<
  ProgramAuthoringSubmitResult,
  { readonly kind: 'failure' }
> | null> {
  const pending = options.candidates.filter((candidate) => {
    const upload = options.runtime.uploads.get(candidate.localId);
    const cachedFile = options.runtime.uploadFiles.get(candidate.localId);
    const valid =
      upload !== undefined &&
      cachedFile === candidate.file &&
      upload.expiresAt !== undefined &&
      Date.parse(upload.expiresAt) > Date.now();
    if (valid) return false;
    options.runtime.uploads.delete(candidate.localId);
    options.runtime.uploadFiles.delete(candidate.localId);
    return true;
  });
  if (pending.length === 0) return null;
  const results = await Promise.allSettled(
    pending.map(async ({ localId, file }) => ({
      localId,
      upload: await options.api.uploadFile(file),
    })),
  );
  const successful = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  if (successful.length !== pending.length) {
    await Promise.allSettled(
      successful.map(({ upload }) => options.api.deleteUpload(upload.id)),
    );
    return {
      kind: 'failure',
      stage: 'upload',
      message:
        '양식 파일을 올리지 못했습니다. 파일은 유지되며 다시 시도하면 자동으로 재업로드합니다.',
    };
  }
  for (const { localId, upload } of successful) {
    options.runtime.uploads.set(localId, upload);
    const candidate = pending.find((item) => item.localId === localId);
    if (candidate !== undefined)
      options.runtime.uploadFiles.set(localId, candidate.file);
  }
  return null;
}

export async function cleanupPreparedUploads(options: {
  readonly runtime: ProgramSubmissionRuntime;
  readonly localIds: readonly string[];
  readonly deleteUpload: (uploadId: string) => Promise<void>;
}): Promise<void> {
  const uploads = options.localIds.flatMap((localId) => {
    const upload = options.runtime.uploads.get(localId);
    return upload === undefined ? [] : [[localId, upload] as const];
  });
  const results = await Promise.allSettled(
    uploads.map(([, upload]) => options.deleteUpload(upload.id)),
  );
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const localId = uploads[index]?.[0];
    if (localId !== undefined) options.runtime.uploads.delete(localId);
    if (localId !== undefined) options.runtime.uploadFiles.delete(localId);
  });
}
