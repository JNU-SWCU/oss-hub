import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createListScreenRoot as createRoot,
  useTestSearchParams,
} from '../../../../../../test-support/list-screen-root';

const mocks = vi.hoisted(() => ({
  session: { hasStaffAccess: false, hasAdminAccess: false },
  getBoardPost: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: useTestSearchParams,
  usePathname: () => '/programs/program-1/board/post-1',
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../../../../_shell/session-role-context', () => ({
  useSharedSessionRole: () => mocks.session,
}));

vi.mock('@/features/board/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/board/api')>()),
  getBoardPost: mocks.getBoardPost,
}));

import { BoardDetailRoute } from './board-detail-route';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('BoardDetailRoute staff treatment', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    mocks.getBoardPost.mockReset();
    mocks.getBoardPost.mockResolvedValue({
      id: 'post-1',
      programId: 'program-1',
      authorName: '합성 작성자',
      category: 'NOTICE',
      title: '합성 공지',
      body: '합성 본문',
      pinned: false,
      createdAt: '2026-08-01T03:00:00.000Z',
      updatedAt: '2026-08-01T03:00:00.000Z',
      commentCount: 0,
      canEdit: false,
      canDelete: false,
      comments: [],
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
    ['학생', false, false, false],
    ['학생+관리자', false, true, true],
    ['교직원', true, false, true],
  ])(
    '%s 계정의 고정 컨트롤은 백엔드 권한과 같다',
    async (_, hasStaffAccess, hasAdminAccess, canPin) => {
      mocks.session = { hasStaffAccess, hasAdminAccess };

      await act(async () => {
        root.render(<BoardDetailRoute programId="program-1" postId="post-1" />);
      });
      await act(async () => {
        await mocks.getBoardPost.mock.results[0]?.value;
      });

      expect(container.textContent).toContain('합성 공지');
      const pinButton = [...container.querySelectorAll('button')].some(
        (button) => button.textContent === '고정',
      );
      expect(pinButton).toBe(canPin);
    },
  );
});
