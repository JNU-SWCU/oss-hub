import type { ReactNode } from 'react';
import { RoleGate } from './role-gate';
import type { MemberSurface } from './member-access';

export function RolePanelShell({
  allow,
  deniedPath,
  children,
}: {
  allow: readonly MemberSurface[];
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
