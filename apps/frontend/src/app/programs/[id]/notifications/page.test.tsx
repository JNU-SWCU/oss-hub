import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_shell/role-panel-shell', () => ({
  RolePanelShell: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => <section data-allow={allow.join(',')}>{children}</section>,
}));

vi.mock('@/features/programs/notifications/program-notifications-page', () => ({
  ProgramNotificationsPage: ({ programId }: { readonly programId: string }) => (
    <div data-program-id={programId}>program notifications</div>
  ),
}));

import ProgramNotificationsPageRoute from './page';

describe('ProgramNotificationsPageRoute access contract', () => {
  it('allows only STAFF and passes the decoded program id', async () => {
    const html = renderToStaticMarkup(
      await ProgramNotificationsPageRoute({
        params: Promise.resolve({ id: 'seed%3Ademo%3Aprogram%3Abootcamp' }),
      }),
    );

    expect(html).toContain('data-allow="staff"');
    expect(html).toContain('data-program-id="seed:demo:program:bootcamp"');
    expect(html).not.toContain('student');
  });
});
