import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import {
  changeRequestTargetCount,
  createProgramDocumentChangeRequest,
  getProgramDocumentChangeRequestTargets,
} from './program-document-change-request-api';

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));

beforeEach(() => {
  vi.mocked(apiClient).mockReset().mockResolvedValue({});
});

describe('program document change request api', () => {
  it('asks for team targets with an encoded program and team only', async () => {
    await getProgramDocumentChangeRequestTargets('program:a/b', {
      kind: 'TEAM',
      teamId: 'team&1',
    });

    expect(apiClient).toHaveBeenCalledWith(
      'programs/program%3Aa%2Fb/documents/change-requests/targets?scope=TEAM&teamId=team%261',
    );
  });

  it('sends the program scope without a team and with the confirmed count', async () => {
    await createProgramDocumentChangeRequest('program', {
      scope: { kind: 'PROGRAM' },
      includeFinalDecisions: true,
      comment: '다시 내 주세요.',
      resubmissionDueAt: '2099-06-30T14:59:00.000Z',
      expectedCount: 4,
    });

    const [path, init] = vi.mocked(apiClient).mock.calls[0] ?? [];
    expect(path).toBe('programs/program/documents/change-requests');
    expect(init?.method).toBe('POST');
    const body = init?.body;
    if (typeof body !== 'string') throw new TypeError('Missing JSON body');
    expect(JSON.parse(body)).toEqual({
      scope: 'PROGRAM',
      includeFinalDecisions: true,
      comment: '다시 내 주세요.',
      resubmissionDueAt: '2099-06-30T14:59:00.000Z',
      expectedCount: 4,
    });
  });

  it('counts finished decisions only when they are reopened', () => {
    const targets = {
      submitted: 2,
      changesRequested: 1,
      approved: 3,
      rejected: 1,
    };

    expect(changeRequestTargetCount(targets, false)).toBe(3);
    expect(changeRequestTargetCount(targets, true)).toBe(7);
  });
});
