import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { completedAuthoringState } from './program-creation-test-fixtures';
import {
  createProgramSubmissionRuntime,
  submitProgramAuthoring,
} from './program-authoring-submit';

function pdfFile(name = 'plan.pdf'): File {
  return new File(['%PDF- synthetic'], name, { type: 'application/pdf' });
}

function stateWithFiles() {
  const completed = completedAuthoringState();
  return {
    ...completed,
    milestones: [
      {
        ...completed.milestones[0],
        requirements: [
          {
            id: 'requirement-a',
            name: '계획서',
            required: true,
            submissionType: 'FILE' as const,
            templateFile: {
              name: 'plan.pdf',
              size: 15,
              type: 'application/pdf',
              requiresReselection: false,
            },
          },
          {
            id: 'requirement-b',
            name: '결과서',
            required: false,
            submissionType: 'FILE' as const,
            templateFile: {
              name: 'result.pdf',
              size: 15,
              type: 'application/pdf',
              requiresReselection: false,
            },
          },
        ],
      },
    ],
  };
}

describe('program authoring submission', () => {
  it('ignores a duplicate click while one idempotent submit is in flight', async () => {
    // Given
    let resolveCreate: ((value: { readonly id: string }) => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<{ readonly id: string }>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const runtime = createProgramSubmissionRuntime();
    const options = {
      state: completedAuthoringState(),
      files: new Map<string, File>(),
      runtime,
      api: {
        uploadFile: vi.fn(),
        deleteUpload: vi.fn(),
        createProgram: create,
      },
    };

    // When
    const first = submitProgramAuthoring(options);
    const duplicate = await submitProgramAuthoring(options);

    // Then
    expect(duplicate).toEqual({ kind: 'ignored' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.any(Object), 'request-1');
    resolveCreate?.({ id: 'program-created' });
    await expect(first).resolves.toEqual({
      kind: 'success',
      programId: 'program-created',
    });
  });

  it('keeps File objects and automatically re-uploads them after a partial upload failure', async () => {
    // Given
    const firstFile = pdfFile();
    const secondFile = pdfFile('result.pdf');
    const files = new Map([
      ['requirement-a', firstFile],
      ['requirement-b', secondFile],
    ]);
    const uploadFile = vi
      .fn()
      .mockResolvedValueOnce({ id: 'upload-a' })
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce({ id: 'upload-a-retry' })
      .mockResolvedValueOnce({ id: 'upload-b-retry' });
    const deleteUpload = vi.fn(async () => undefined);
    const createProgram = vi.fn(async () => ({ id: 'program-created' }));
    const runtime = createProgramSubmissionRuntime();
    const options = {
      state: stateWithFiles(),
      files,
      runtime,
      api: { uploadFile, deleteUpload, createProgram },
    };

    // When
    const failed = await submitProgramAuthoring(options);
    const retried = await submitProgramAuthoring(options);

    // Then
    expect(failed).toEqual(
      expect.objectContaining({ kind: 'failure', stage: 'upload' }),
    );
    expect(retried).toEqual({
      kind: 'success',
      programId: 'program-created',
    });
    expect(uploadFile).toHaveBeenCalledTimes(4);
    expect(uploadFile).toHaveBeenNthCalledWith(1, firstFile);
    expect(uploadFile).toHaveBeenNthCalledWith(3, firstFile);
    expect(deleteUpload).toHaveBeenCalledWith('upload-a');
  });

  it('retries a failed aggregate with the same tokens and idempotency key', async () => {
    // Given
    const uploadFile = vi.fn(async () => ({ id: 'upload-a' }));
    const createProgram = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('gateway closed'))
      .mockResolvedValueOnce({ id: 'program-created' });
    const runtime = createProgramSubmissionRuntime();
    const options = {
      state: {
        ...stateWithFiles(),
        milestones: [
          {
            ...stateWithFiles().milestones[0],
            requirements: [stateWithFiles().milestones[0]?.requirements[0]],
          },
        ],
      },
      files: new Map([['requirement-a', pdfFile()]]),
      runtime,
      api: {
        uploadFile,
        deleteUpload: vi.fn(),
        createProgram,
      },
    };

    // When
    const failed = await submitProgramAuthoring(options);
    const retried = await submitProgramAuthoring(options);

    // Then
    expect(failed).toEqual(
      expect.objectContaining({ kind: 'failure', stage: 'aggregate' }),
    );
    expect(retried.kind).toBe('success');
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(createProgram).toHaveBeenCalledTimes(2);
    expect(createProgram.mock.calls[0]?.[1]).toBe('request-1');
    expect(createProgram.mock.calls[1]?.[1]).toBe('request-1');
  });

  it('maps a 409 conflict without clearing entered state or uploaded tokens', async () => {
    // Given
    const runtime = createProgramSubmissionRuntime();
    const file = pdfFile();
    const createProgram = vi.fn(async () => {
      throw new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'The idempotency key was already used.',
        instance: '/program-authoring/programs',
        code: 'SYS_009',
      });
    });

    // When
    const result = await submitProgramAuthoring({
      state: {
        ...stateWithFiles(),
        milestones: [
          {
            ...stateWithFiles().milestones[0],
            requirements: [stateWithFiles().milestones[0]?.requirements[0]],
          },
        ],
      },
      files: new Map([['requirement-a', file]]),
      runtime,
      api: {
        uploadFile: vi.fn(async () => ({ id: 'upload-a' })),
        deleteUpload: vi.fn(),
        createProgram,
      },
    });

    // Then
    expect(result).toEqual({ kind: 'conflict' });
    expect(runtime.uploads.get('requirement-a')).toEqual({ id: 'upload-a' });
    expect(file.name).toBe('plan.pdf');
  });
});
