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

vi.mock('@/features/staff-insights/staff-insights-screen', () => ({
  StaffInsightsScreen: () => <div>insights screen</div>,
}));

import Page from './page';

describe('StaffInsightsPage access contract', () => {
  it('백엔드 audience와 같이 승인된 교직원을 허용한다', async () => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain('data-allow="staff"');
    expect(html).toContain('insights screen');
  });
});
