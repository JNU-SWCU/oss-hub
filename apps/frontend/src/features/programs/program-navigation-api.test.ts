import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { getProgramNavigationMilestones } from './program-navigation-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getProgramNavigationMilestones', () => {
  it('공개 상세에서 모든 단계의 탐색 정보만 추린다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          milestones: [
            {
              id: 'plan',
              name: '1차 계획서',
              submissionType: 'TEXT',
              submissionItemCount: 0,
            },
            {
              id: 'documents',
              name: '요구 서류',
              submissionType: null,
              submissionItemCount: 2,
            },
            {
              id: 'notice',
              name: '안내',
              submissionType: null,
              submissionItemCount: 0,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProgramNavigationMilestones('program 1')).resolves.toEqual([
      {
        milestoneId: 'plan',
        title: '1차 계획서',
        submissionEnabled: true,
      },
      {
        milestoneId: 'documents',
        title: '요구 서류',
        submissionEnabled: true,
      },
      {
        milestoneId: 'notice',
        title: '안내',
        submissionEnabled: false,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program%201'),
      undefined,
    );
  });
});
