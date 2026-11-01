import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../_shell/role-gate', () => ({
  RoleGate: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => <section data-allow={allow.join(',')}>{children}</section>,
}));

vi.mock('./board-detail-route', () => ({
  BoardDetailRoute: () => <div>board detail</div>,
}));

import Page from './page';

describe('ProgramBoardDetailRoutePage access contract', () => {
  it('관리자 단독 계정도 게시글을 연다', async () => {
    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ id: 'program-1', postId: 'post-1' }),
      }),
    );

    expect(html).toContain('data-allow="student,staff,admin"');
    expect(html).toContain('board detail');
  });
});
