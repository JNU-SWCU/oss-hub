import { describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

import ProgramMyTeamRedirectPage from './page';

describe('legacy my-team route', () => {
  it('인코딩된 프로그램 id를 그대로 지켜 우리 팀 경로로 보낸다', async () => {
    await ProgramMyTeamRedirectPage({
      params: Promise.resolve({ id: 'program%3Abasic' }),
    });

    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      '/programs/program%3Abasic/team',
    );
  });
});
