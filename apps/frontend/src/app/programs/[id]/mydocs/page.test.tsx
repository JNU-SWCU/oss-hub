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

vi.mock('./mydocs-route', () => ({
  MyDocsRoute: ({ programId }: { readonly programId: string }) => (
    <div data-mydocs-program-id={programId}>my docs</div>
  ),
}));

import ProgramMyDocsPage from './page';

describe('ProgramMyDocsPage access contract', () => {
  it('STUDENT만 내 제출물 화면에 허용한다', async () => {
    const page = await ProgramMyDocsPage({
      params: Promise.resolve({ id: 'program%3Abasic' }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-allow="student"');
    expect(html).toContain('data-mydocs-program-id="program:basic"');
  });
});
