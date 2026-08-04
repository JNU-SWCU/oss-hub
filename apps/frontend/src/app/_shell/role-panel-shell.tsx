import type { ReactNode } from 'react';
import { RoleGate } from './role-gate';
import type { AppRole } from './role';

/**
 * 역할 화면 셸 — 접근 게이트(`RoleGate`)만 담당한다.
 *
 * 메뉴는 셸이 그린다 — 상단 공개(`ShellNav`/`PUBLIC_MENU`), 왼쪽 내 상황
 * (`AppSidebar`/`role-menus`). 이 컴포넌트는 역할 허용만 보고 메뉴 prop은 없다.
 */
export function RolePanelShell({
  allow,
  deniedPath,
  children,
}: {
  allow: readonly AppRole[];
  deniedPath?: string;
  children: ReactNode;
}) {
  return (
    <RoleGate allow={allow} deniedPath={deniedPath}>
      <div data-slot="role-panel-shell" className="min-w-0">
        {children}
      </div>
    </RoleGate>
  );
}
