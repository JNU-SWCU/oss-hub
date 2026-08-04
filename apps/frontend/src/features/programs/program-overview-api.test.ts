import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { getProgramOverview } from './program-overview-api';
import type { ProgramOverview } from './program-overview-api';

const overview: ProgramOverview = {
  programId: 'program-1',
  name: 'OSS 경진대회',
  category: 'OSS_CONTEST',
  lifecycle: 'ACTIVE',
  milestoneCount: 3,
  boardPostCount: 5,
  participantCount: 12,
  teamCount: 4,
  connectedRepositoryCount: 3,
  viewerRole: 'STUDENT',
  viewerDocumentsCompleted: 2,
  viewerDocumentsTotal: 5,
  fullySubmittedParticipantCount: null,
  nextMilestone: null,
  milestoneDocuments: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getProgramOverview', () => {
  it('programId를 인코딩해 올바른 경로로 GET 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(overview), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProgramOverview('program 1')).resolves.toEqual(overview);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program%201/overview'),
      undefined,
    );
  });
});
