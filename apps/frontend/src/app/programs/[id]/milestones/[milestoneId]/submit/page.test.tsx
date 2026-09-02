import { describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

import MilestoneSubmitPage from './page';

describe('legacy milestone submit route', () => {
  it('통합 서류 화면의 선택 마일스톤 제출 창으로 보낸다', async () => {
    await MilestoneSubmitPage({
      params: Promise.resolve({
        id: 'program%3Abasic',
        milestoneId: 'final%2Freport',
      }),
    });

    expect(redirect).toHaveBeenCalledWith(
      '/programs/program%3Abasic/documents?milestoneId=final%2Freport',
    );
  });
});
