import type { ReactNode } from 'react';
import type { NavItem } from '@/components';
import { RoleGate } from './role-gate';
import type { AppRole } from './role';

/**
 * 역할 화면 셸 — 이제는 접근 게이트(`RoleGate`)만 담당한다.
 *
 * 예전에는 여기서 좌측 역할 메뉴 패널까지 그렸다. 미감 시안 v2에서 메뉴는 화면
 * 안이 아니라 셸의 왼쪽 사이드바(`ProductShell` → `AppSidebar`)로 올라갔으므로,
 * 그대로 두면 같은 메뉴가 한 화면에 두 벌 나온다.
 *
 * `menu` prop은 계속 받는다 — 호출부 30여 곳이 넘기고 있고, 사이드바가 역할별
 * 메뉴를 같은 `role-menus.ts`에서 읽으므로 값 자체는 여전히 유효하다. 다만 이
 * 컴포넌트는 더 이상 그것을 그리지 않는다.
 */
export function RolePanelShell({
  allow,
  deniedPath,
  children,
}: {
  /** @deprecated 왼쪽 사이드바(`AppSidebar`)가 대신 그린다. 호출부 호환용으로만 남는다. */
  menu?: NavItem[];
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
