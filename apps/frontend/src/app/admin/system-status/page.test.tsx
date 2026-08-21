import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/system-status/components/system-status-screen', () => ({
  SystemStatusScreen: () => (
    <section data-testid="system-status-screen">실제 시스템 상태 화면</section>
  ),
}));
vi.mock('../../_shell/role-panel-shell', () => ({
  RolePanelShell: ({
    allow,
    children,
  }: {
    allow: string[];
    children: ReactNode;
  }) => (
    <div data-shell="role-panel" data-allow={allow.join(',')}>
      {children}
    </div>
  ),
}));
// `role-menus` mock은 두지 않는다 — 이 라우트는 더 이상 메뉴를 import하지
// 않으므로(RolePanelShell의 죽은 `menu` prop 제거) 없는 의존을 흉내 내는 셈이다.

import AdminSystemStatusPage from './page';

describe('AdminSystemStatusPage', () => {
  it('ADMIN RolePanelShell을 유지하고 실제 상태 화면을 렌더링한다', () => {
    const html = renderToStaticMarkup(<AdminSystemStatusPage />);
    expect(html).toContain('data-shell="role-panel"');
    expect(html).toContain('data-allow="admin"');
    expect(html).toContain('data-testid="system-status-screen"');
    expect(html).toContain('실제 시스템 상태 화면');
    expect(html).not.toContain('Ticket #133');
    expect(html).not.toContain('준비 중');
  });
});
