import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../_shell/role-panel-shell', () => ({
  RolePanelShell: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => <section data-allow={allow.join(',')}>{children}</section>,
}));

import ProgramApplicationDetailRoute from './page';

describe('ProgramApplicationDetailRoute access contract', () => {
  it('allows STAFF and ADMIN and links back to applicants on the new path', async () => {
    const html = renderToStaticMarkup(
      await ProgramApplicationDetailRoute({
        params: Promise.resolve({
          id: 'program%3Abasic',
          applicationId: 'app%3A1',
        }),
      }),
    );

    expect(html).toContain('data-allow="STAFF,ADMIN"');
    expect(html).toContain('신청 ID: app:1');
    expect(html).toContain('href="/programs/program%3Abasic/applicants"');
    expect(html).not.toContain('STUDENT');
  });
});
