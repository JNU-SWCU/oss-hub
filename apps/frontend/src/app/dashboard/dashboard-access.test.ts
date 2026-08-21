import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MemberSurface } from '../_shell/member-access';
import { RolePanelShell } from '../_shell/role-panel-shell';
import { DASHBOARD_ALLOWED_SURFACES } from './dashboard-access';

// 본문 컴포넌트는 이 파일의 관심사가 아니다 — 여기서 고정하는 것은 게이트 하나다.
// (본문 분기는 `dashboard-home.test.tsx`.)
vi.mock('./dashboard-home', () => ({ DashboardHome: () => null }));

import DashboardPage from './page';

interface GateProps {
  readonly allow: readonly MemberSurface[];
  readonly deniedPath?: string;
}

function renderGate(): ReactElement<GateProps> {
  return DashboardPage() as ReactElement<GateProps>;
}

/**
 * 대시보드 입구가 다시 좁아지지 않게 막는 자리.
 *
 * 이 화면의 직전 결함이 정확히 "허용 역할이 좁았던 것"이다 — 상단 Nav는 회원 전원에게
 * 「대시보드」를 내미는데 페이지는 STUDENT만 받아, 교직원·관리자가 자기에게 보이는
 * 메뉴를 눌러 접근 거부 화면으로 떨어졌다. 본문 분기 테스트는 게이트를 통과한 뒤를
 * 보므로 그 회귀에 초록을 준다. 그래서 게이트를 따로 못 박는다.
 */
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
  // 상수만 검사하면 페이지가 그 상수를 **쓰지 않고** 목록을 다시 적어 넣는 회귀를
  // 놓친다. 라우트가 실제로 무엇을 게이트에 넘기는지까지 본다.
  it('게이트에 넘기는 허용 역할이 회원 공통 입구 계약과 같다', () => {
    const gate = renderGate();

    expect(gate.type).toBe(RolePanelShell);
    expect(gate.props.allow).toBe(DASHBOARD_ALLOWED_SURFACES);
  });

  it('역할 불일치를 다른 역할 홈으로 떠넘기지 않는다', () => {
    // `deniedPath`를 주면 "이 화면은 남의 것이니 저리로 가라"는 뜻이 된다. 회원 공통
    // 입구에는 그 목적지가 없다 — 세 역할 모두 여기가 자기 홈이다.
    expect(renderGate().props.deniedPath).toBeUndefined();
  });
});
