import { describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

import ProgramSubmissionsPage from './page';

describe('legacy submission checklist route', () => {
  it('선택 마일스톤을 통합 서류 경로로 보낸다', async () => {
    await ProgramSubmissionsPage({
      params: Promise.resolve({ id: 'program%3Abasic' }),
      searchParams: Promise.resolve({ milestoneId: 'final/report' }),
    });

    expect(redirect).toHaveBeenCalledWith(
      '/programs/program%3Abasic/documents?milestoneId=final%2Freport',
    );
  });

  it('마일스톤 없이 통합 서류 경로로 보낸다', async () => {
    redirect.mockClear();

    await ProgramSubmissionsPage({
      params: Promise.resolve({ id: 'program%3Abasic' }),
      searchParams: Promise.resolve({}),
    });

    expect(redirect).toHaveBeenCalledWith(
      '/programs/program%3Abasic/documents',
    );
  });
});
