import { ApiError } from '@/lib/api-client';
import type { ProgramAuthoringUpload } from './program-authoring-api';
import { buildProgramAuthoringManifest } from './program-authoring-manifest';
import type { ProgramAuthoringState } from './program-authoring-model';

export interface ProgramAuthoringSubmitApi {
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
}

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
  return { submitting: false, uploads: new Map() };
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

async function ensureUploads(options: {
  readonly state: ProgramAuthoringState;
  readonly files: ReadonlyMap<string, File>;
  readonly runtime: ProgramSubmissionRuntime;
  readonly api: ProgramAuthoringSubmitApi;
}): Promise<Extract<
  ProgramAuthoringSubmitResult,
  { readonly kind: 'failure' }
> | null> {
  const pending: { readonly requirementId: string; readonly file: File }[] = [];
  for (const milestone of options.state.milestones) {
    for (const requirement of milestone.requirements) {
      if (
        requirement.templateFile === null ||
        options.runtime.uploads.has(requirement.id)
      ) {
        continue;
      }
      const file = options.files.get(requirement.id);
      if (file === undefined) {
        return {
          kind: 'failure',
          stage: 'upload',
          message: '파일 재선택 필요',
        };
      }
      pending.push({ requirementId: requirement.id, file });
    }
  }
  if (pending.length === 0) return null;

  const results = await Promise.allSettled(
    pending.map(async ({ requirementId, file }) => ({
      requirementId,
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
  for (const { requirementId, upload } of successful) {
    options.runtime.uploads.set(requirementId, upload);
  }
  return null;
}
