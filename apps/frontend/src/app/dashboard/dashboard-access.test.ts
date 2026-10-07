import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MemberSurface } from '../_shell/member-access';
import { RolePanelShell } from '../_shell/role-panel-shell';
import { DASHBOARD_ALLOWED_SURFACES } from './dashboard-access';

vi.mock('./dashboard-home', () => ({ DashboardHome: () => null }));

import DashboardPage from './page';

interface GateProps {
  readonly allow: readonly MemberSurface[];
  readonly deniedPath?: string;
}

function renderGate(): ReactElement<GateProps> {
  return DashboardPage() as ReactElement<GateProps>;
}

describe('DASHBOARD_ALLOWED_SURFACES', () => {
  it.each(['student', 'staff', 'admin'] as const)(
    '%s surface는 대시보드 입구를 쓴다',
    (surface) => {
      expect(DASHBOARD_ALLOWED_SURFACES).toContain(surface);
    },
  );

  it('회원 공통 입구라 세 역할 말고는 늘지도 줄지도 않는다', () => {
    expect([...DASHBOARD_ALLOWED_SURFACES].sort()).toEqual([
      'admin',
      'staff',
      'student',
    ]);
  });
});

describe('DashboardPage', () => {
  it('게이트에 넘기는 허용 역할이 회원 공통 입구 계약과 같다', () => {
    const gate = renderGate();

    expect(gate.type).toBe(RolePanelShell);
    expect(gate.props.allow).toBe(DASHBOARD_ALLOWED_SURFACES);
  });

  it('역할 불일치를 다른 역할 홈으로 떠넘기지 않는다', () => {
    expect(renderGate().props.deniedPath).toBeUndefined();
  });
});
