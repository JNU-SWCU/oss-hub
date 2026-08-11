import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '../../lib/api-client';
import {
  createAuthoringProgram,
  deleteAuthoringUpload,
  uploadAuthoringFile,
} from './program-authoring-api';
import { completedAuthoringState } from './program-creation-test-fixtures';
import { buildProgramAuthoringManifest } from './program-creation-flow';

describe('program authoring API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploads multipart files through the shared API client', async () => {
    const request = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(
          JSON.stringify({
            id: 'upload-id',
            fileName: 'plan.pdf',
            contentType: 'application/pdf',
            size: 15,
            expiresAt: '2026-09-02T00:00:00.000Z',
          }),
          { status: 200 },
        );
      },
    );
    vi.stubGlobal('fetch', request);

    const result = await uploadAuthoringFile(
      new File(['%PDF- synthetic'], 'plan.pdf', { type: 'application/pdf' }),
    );

    expect(result.id).toBe('upload-id');
    expect(request).toHaveBeenCalledWith(
      apiPath('/program-authoring/uploads'),
      expect.any(Object),
    );
  });

  it('sends the final manifest with the idempotency key and supports explicit upload deletion', async () => {
    const request = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'DELETE')
          return new Response(null, { status: 204 });
        expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(
          'request-1',
        );
        return new Response(JSON.stringify({ id: 'program-created' }), {
          status: 201,
        });
      },
    );
    vi.stubGlobal('fetch', request);
    const manifest = buildProgramAuthoringManifest(
      completedAuthoringState(),
      new Map(),
    );

    await expect(
      createAuthoringProgram(manifest, 'request-1'),
    ).resolves.toEqual({ id: 'program-created' });
    await expect(deleteAuthoringUpload('upload-id')).resolves.toBeUndefined();
    expect(request).toHaveBeenNthCalledWith(
      2,
      apiPath('/program-authoring/uploads/upload-id'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
