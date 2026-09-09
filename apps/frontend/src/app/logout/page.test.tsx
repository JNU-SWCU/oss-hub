import { describe, expect, it, vi } from 'vitest';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

import LogoutPage from './page';

describe('legacy logout route', () => {
  it('완료 화면을 다시 띄우지 않고 홈으로 이동한다', () => {
    LogoutPage();

    expect(redirect).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith('/');
  });
});
