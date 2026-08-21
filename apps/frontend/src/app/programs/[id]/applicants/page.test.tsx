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

vi.mock('@/features/programs/program-applicants-page', () => ({
  ProgramApplicantsPage: ({ programId }: { readonly programId: string }) => (
    <div data-program-id={programId}>program applicants</div>
  ),
}));

import ProgramApplicantsPageRoute from './page';

describe('ProgramApplicantsPageRoute access contract', () => {
  it('allows STAFF and ADMIN to open applicants by canonical program id', async () => {
    const html = renderToStaticMarkup(
      await ProgramApplicantsPageRoute({
        params: Promise.resolve({ id: 'program%3Abasic' }),
      }),
    );

    expect(html).toContain('data-allow="staff"');
    expect(html).toContain('data-program-id="program:basic"');
    expect(html).not.toContain('STUDENT');
  });
});
