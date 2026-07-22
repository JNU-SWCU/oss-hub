import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  createMilestone,
  deleteMilestone,
  getEditableProgram,
  updateMilestone,
  updateProgram,
} from './api';

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('program edit API', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads editable fields through the guarded edit endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'program-1' }));

    await getEditableProgram('program-1');

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/edit'),
      undefined,
    );
  });

  it('patches team fields through the canonical program endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'program-1' }));

    await updateProgram('program-1', {
      name: 'OSS',
      organizer: 'Center',
      category: 'OSS_CONTEST',
      applicationStartAt: '2026-08-01T00:00:00.000Z',
      applicationEndAt: '2026-08-15T00:00:00.000Z',
      repositoryProvisioningEnabled: false,
      description: 'overview',
      teamMinSize: 2,
      teamMaxSize: 4,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1'),
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      category: 'OSS_CONTEST',
      teamMinSize: 2,
      teamMaxSize: 4,
    });
  });

  it('keeps milestone mutations on canonical id endpoints', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ id: 'milestone-1' })),
    );
    const input = {
      name: 'Final',
      dueAt: '2026-08-20T00:00:00.000Z',
      submissionType: 'REPOSITORY_RELEASE' as const,
      instructions: 'tag',
    };

    await createMilestone('program-1', input);
    await updateMilestone('milestone-1', input);
    await deleteMilestone('milestone-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      apiPath('programs/program-1/milestones'),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      apiPath('milestones/milestone-1'),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      apiPath('milestones/milestone-1'),
    );
  });
});
