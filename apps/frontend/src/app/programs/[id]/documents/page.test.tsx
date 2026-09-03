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

vi.mock('./documents-route', () => ({
  DocumentsRoute: ({ programId }: { readonly programId: string }) => (
    <div data-documents-program-id={programId}>documents</div>
  ),
}));

import ProgramDocumentsPage from './page';

describe('ProgramDocumentsPage access contract', () => {
  it('학생과 교직원이 같은 서류 화면에 들어가도록 허용한다', async () => {
    const page = await ProgramDocumentsPage({
      params: Promise.resolve({ id: 'program%3Abasic' }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-allow="student,staff"');
    expect(html).toContain('data-documents-program-id="program:basic"');
  });
});
