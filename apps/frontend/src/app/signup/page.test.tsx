import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

import SignupPage from './page';

describe('legacy signup route', () => {
  beforeEach(() => redirect.mockReset());

  it('로그인 화면 대신 랜딩으로 보낸다', async () => {
    await SignupPage({});

    expect(redirect).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('돌아갈 업무 경로는 랜딩 주소에 실어 보낸다', async () => {
    await SignupPage({
      searchParams: Promise.resolve({ returnTo: '/programs/42/apply' }),
    });

    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      '/?returnTo=%2Fprograms%2F42%2Fapply',
    );
  });

  it.each(['//evil.example', '/signup', '/consent', '/programs?token=x'])(
    '외부·절차·쿼리 경로 %s는 버리고 랜딩으로만 보낸다',
    async (returnTo) => {
      await SignupPage({ searchParams: Promise.resolve({ returnTo }) });

      expect(redirect).toHaveBeenCalledExactlyOnceWith('/');
    },
  );
});
