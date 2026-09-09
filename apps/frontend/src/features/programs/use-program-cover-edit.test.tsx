// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { mapProgramEditError } from './program-edit-flow';
import { useProgramCoverEdit } from './use-program-cover-edit';

const api = vi.hoisted(() => ({
  uploadProgramCover: vi.fn(),
  deleteAuthoringUpload: vi.fn(),
}));
vi.mock('./program-authoring-api', () => api);
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

it('reuploads the retained file after a committed save loses its response and the consumed token is rejected', async () => {
  let editor: ReturnType<typeof useProgramCoverEdit> | undefined;
  function Editor() {
    editor = useProgramCoverEdit();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  const invalidToken = new ApiError({
    type: 'about:blank',
    title: 'Validation failed',
    status: 400,
    detail: '프로그램 입력값을 확인해 주세요.',
    instance: '/programs/example',
    code: 'PRG_001',
    fieldErrors: [
      {
        field: 'coverUploadId',
        code: 'INVALID_UPLOAD_TOKEN',
        message: '대표 이미지 파일을 다시 선택해 주세요.',
      },
    ],
  });
  api.uploadProgramCover
    .mockResolvedValueOnce({
      id: 'consumed-cover',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    .mockResolvedValueOnce({
      id: 'fresh-cover',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
  const save = vi
    .fn<
      (input: {
        readonly kind: string;
        readonly coverUploadId?: string | null;
      }) => Promise<void>
    >()
    .mockRejectedValueOnce(new TypeError('Response lost after commit'))
    .mockRejectedValueOnce(invalidToken)
    .mockResolvedValueOnce(undefined);
  const current = () => {
    if (editor === undefined) throw new Error('Editor did not mount');
    return editor;
  };
  try {
    await act(async () => root.render(<Editor />));
    const file = new File(['synthetic'], 'cover.png', { type: 'image/png' });
    await act(async () => current().change(file));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prepared = await current().prepare();
      expect(prepared.kind).toBe('ready');
      try {
        await save(prepared);
        await act(async () => current().saved());
      } catch (error: unknown) {
        current().failed(error);
        expect(current().selection).toBe(file);
      }
    }
    expect(save.mock.calls.map(([input]) => input.coverUploadId)).toEqual([
      'consumed-cover',
      'consumed-cover',
      'fresh-cover',
    ]);
    expect(api.uploadProgramCover).toHaveBeenCalledTimes(2);
    expect(api.uploadProgramCover).toHaveBeenLastCalledWith(file);
    expect(current().selection).toBeUndefined();
    expect(mapProgramEditError(invalidToken).coverUploadId).toBe(
      '대표 이미지를 저장하지 못했습니다. 선택한 이미지는 유지됩니다. 다시 저장해 주세요.',
    );
  } finally {
    await act(async () => root.unmount());
  }
});
afterEach(() => vi.resetAllMocks());

it('preserves the existing cover, keeps a retryable replacement, and distinguishes remove from unchanged', async () => {
  let editor: ReturnType<typeof useProgramCoverEdit> | undefined;
  function Editor() {
    editor = useProgramCoverEdit();
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Editor />));
    const current = () => {
      if (editor === undefined) throw new Error('Editor did not mount');
      return editor;
    };
    expect(await current().prepare()).toEqual({ kind: 'ready' });
    const file = new File(['synthetic'], 'cover.png', { type: 'image/png' });
    api.uploadProgramCover
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        id: 'pending-cover',
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
    await act(async () => current().change(file));
    expect(await current().prepare()).toMatchObject({ kind: 'failure' });
    expect(current().selection).toBe(file);
    expect(await current().prepare()).toEqual({
      kind: 'ready',
      coverUploadId: 'pending-cover',
    });
    expect(await current().prepare()).toEqual({
      kind: 'ready',
      coverUploadId: 'pending-cover',
    });
    expect(api.uploadProgramCover).toHaveBeenCalledTimes(2);
    await act(async () => current().saved());
    expect(current().selection).toBeUndefined();
    await act(async () => current().change(null));
    expect(await current().prepare()).toEqual({
      kind: 'ready',
      coverUploadId: null,
    });
    await act(async () => current().change(undefined));
    expect(await current().prepare()).toEqual({ kind: 'ready' });
    expect(api.deleteAuthoringUpload).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
