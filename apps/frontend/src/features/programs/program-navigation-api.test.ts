import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { getProgramNavigationMilestones } from './program-navigation-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getProgramNavigationMilestones', () => {
  it('제출 항목 중심 단계는 레거시 체크리스트 제출 대상으로 분류하지 않는다', async () => {
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
        submissionEnabled: false,
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
