import { describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

import ProgramSubmissionsPage from './page';

describe('legacy submission checklist route', () => {
  it('선택 마일스톤을 프로그램 상세 제출 팝업으로 보낸다', async () => {
    await ProgramSubmissionsPage({
      params: Promise.resolve({ id: 'program%3Abasic' }),
      searchParams: Promise.resolve({ milestoneId: 'final/report' }),
    });

    expect(redirect).toHaveBeenCalledWith(
      '/programs/program%3Abasic?submission=final%2Freport',
    );
  });
});
