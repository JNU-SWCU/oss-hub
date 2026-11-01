import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createListScreenRoot as createRoot,
  useTestSearchParams,
} from '../../../../../test-support/list-screen-root';

const mocks = vi.hoisted(() => ({
  session: { hasStaffAccess: false, hasAdminAccess: false },
  listBoardPosts: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: useTestSearchParams,
  usePathname: () => '/programs/program-1/board',
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../../../_shell/session-role-context', () => ({
  useSharedSessionRole: () => mocks.session,
}));

vi.mock('@/features/board/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/board/api')>()),
  listBoardPosts: mocks.listBoardPosts,
}));

import { BoardListRoute } from './board-list-route';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('BoardListRoute staff treatment', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    mocks.listBoardPosts.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    ['학생', false, false, '질문 쓰기', '프로그램 공지와 질문'],
    ['학생+관리자', false, true, '공지 쓰기', '프로그램 공지와 학생 질문'],
    ['교직원', true, false, '공지 쓰기', '프로그램 공지와 학생 질문'],
  ])(
    '%s 계정은 백엔드 분류와 같은 쓰기 버튼을 본다',
    async (_, hasStaffAccess, hasAdminAccess, button, subtitle) => {
      mocks.session = { hasStaffAccess, hasAdminAccess };

      await act(async () => {
        root.render(<BoardListRoute programId="program-1" />);
      });

      expect(container.textContent).toContain(button);
      expect(container.textContent).toContain(subtitle);
    },
  );
});
