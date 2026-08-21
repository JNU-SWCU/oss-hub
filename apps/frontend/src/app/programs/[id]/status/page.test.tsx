import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_shell/role-panel-shell', () => ({
  RolePanelShell: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => (
    <section data-shell="role-panel" data-allow={allow.join(',')}>
      {children}
    </section>
  ),
}));

vi.mock('@/features/submissions/components/submission-matrix-screen', () => ({
  SubmissionMatrixScreen: ({ programId }: { readonly programId: string }) => (
    <div data-program-id={programId}>submission matrix</div>
  ),
}));

import ProgramStatusPage from './page';

describe('ProgramStatusPage access contract', () => {
  it('STAFF와 ADMIN만 서류 현황 화면에 허용하고 STUDENT는 막는다', async () => {
    const page = await ProgramStatusPage({
      params: Promise.resolve({ id: 'program%3Abasic' }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-allow="staff"');
    expect(html).toContain('data-program-id="program:basic"');
    expect(html).not.toContain('STUDENT');
  });
});
