import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_shell/role-gate', () => ({
  RoleGate: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => <section data-allow={allow.join(',')}>{children}</section>,
}));

vi.mock('./program-teams-route-view', () => ({
  ProgramTeamsRouteView: () => <div>teams view</div>,
}));

import Page from './page';

describe('ProgramTeamsRoutePage access contract', () => {
  it('학생과 승인된 교직원만 팀 화면에 들어간다', async () => {
    const html = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ id: 'program-1' }) }),
    );

    expect(html).toContain('data-allow="student,staff"');
    expect(html).toContain('teams view');
  });
});
