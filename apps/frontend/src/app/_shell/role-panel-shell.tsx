import type { ReactNode } from 'react';
import { RoleGate } from './role-gate';
import type { AppRole } from './role';

/**
 * 역할 화면 셸 — 이제는 접근 게이트(`RoleGate`)만 담당한다.
 *
 * 예전에는 여기서 좌측 역할 메뉴 패널까지 그렸다. 미감 시안 v2에서 메뉴는 화면
 * 안이 아니라 셸의 왼쪽 사이드바(`ProductShell` → `AppSidebar`)로 올라갔으므로,
 * 그대로 두면 같은 메뉴가 한 화면에 두 벌 나온다.
 *
 * 그때 `menu` prop을 호환용으로 남겨 뒀지만, 이 컴포넌트가 그 값을 읽지도
 * 넘기지도 않아 타입에만 존재하는 죽은 prop이었다. 호출부가 `role-menus.ts`의
 * 상수를 계속 import하게 만들어 "이 화면이 메뉴를 그린다"는 오해만 남기므로
 * 제거한다. 메뉴의 단일 원본은 여전히 `role-menus.ts`이고, 그것을 읽어 실제로
 * 그리는 쪽은 `sidebar-menu.ts` → `AppSidebar` 하나뿐이다.
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
