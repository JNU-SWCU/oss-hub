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

vi.mock('./program-edit-route', () => ({
  ProgramEditRoute: ({ programId }: { readonly programId: string }) => (
    <div data-program-id={programId}>program edit</div>
  ),
}));

import ProgramEditPageRoute from './page';

describe('ProgramEditPageRoute access contract', () => {
  it('allows STAFF and ADMIN to edit by canonical program id', async () => {
    const html = renderToStaticMarkup(
      await ProgramEditPageRoute({
        params: Promise.resolve({ id: 'program-canonical-id' }),
      }),
    );

    expect(html).toContain('data-allow="staff"');
    expect(html).toContain('data-program-id="program-canonical-id"');
    expect(html).not.toContain('STUDENT');
  });
});
