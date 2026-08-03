import { describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

import MilestoneSubmitPage from './page';

describe('legacy milestone submit route', () => {
  it('프로그램 상세 제출 팝업으로 보낸다', async () => {
    await MilestoneSubmitPage({
      params: Promise.resolve({
        id: 'program%3Abasic',
        milestoneId: 'final%2Freport',
      }),
    });

    expect(redirect).toHaveBeenCalledWith(
      '/programs/program%3Abasic?submission=final%2Freport',
    );
  });
});
