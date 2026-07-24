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

vi.mock('@/features/programs/program-edit-page', () => ({
  ProgramEditPage: ({ programId }: { readonly programId: string }) => (
    <div data-program-id={programId}>program edit</div>
  ),
}));

import StaffProgramEditPage from './page';

describe('StaffProgramEditPage access contract', () => {
  it('allows STAFF and ADMIN to edit by canonical program id', async () => {
    // Given / When
    const html = renderToStaticMarkup(
      await StaffProgramEditPage({
        params: Promise.resolve({ id: 'program-canonical-id' }),
      }),
    );

    // Then
    expect(html).toContain('data-allow="STAFF,ADMIN"');
    expect(html).toContain('data-program-id="program-canonical-id"');
    expect(html).not.toContain('STUDENT');
  });
});
