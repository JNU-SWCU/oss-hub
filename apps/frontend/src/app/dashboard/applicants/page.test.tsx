import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../_shell/role-panel-shell', () => ({
  RolePanelShell: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => <section data-allow={allow.join(',')}>{children}</section>,
}));

vi.mock(
  '@/features/roles/access-administration/components/admin-access-screen',
  () => ({
    AdminAccessScreen: () => <div>applicant queue</div>,
  }),
);

import Page from './page';

describe('ApplicantQueuePage access contract', () => {
  it('가입 신청 큐 API audience와 같이 교직원과 관리자를 허용한다', async () => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain('data-allow="staff,admin"');
    expect(html).toContain('applicant queue');
  });
});
