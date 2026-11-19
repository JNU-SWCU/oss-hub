import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  previewProgramDeadline,
  sendProgramDeadline,
} from './program-deadline-api';

const responseBody = { ok: true };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('program deadline digest API', () => {
  it('calls the existing preview and send endpoints with guidance and preview version', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await previewProgramDeadline('program/1', {
      studentGuidance: '학생 추가 안내',
      staffGuidance: '교직원 추가 안내',
    });
    await sendProgramDeadline('program/1', {
      previewedAt: '2026-11-19T00:00:00.000Z',
      previewVersion: 'a'.repeat(64),
      studentGuidance: '학생 추가 안내',
      staffGuidance: '교직원 추가 안내',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      apiPath('programs/program%2F1/deadline-digest/preview'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          studentGuidance: '학생 추가 안내',
          staffGuidance: '교직원 추가 안내',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      apiPath('programs/program%2F1/deadline-digest/send'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          previewedAt: '2026-11-19T00:00:00.000Z',
          previewVersion: 'a'.repeat(64),
          studentGuidance: '학생 추가 안내',
          staffGuidance: '교직원 추가 안내',
        }),
      }),
    );
  });
});
