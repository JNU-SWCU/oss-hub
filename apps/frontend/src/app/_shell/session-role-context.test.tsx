import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SessionRoleProvider,
  useSharedSessionRole,
} from './session-role-context';
import type { SessionRoleResult } from './use-session-role';

const SNAPSHOT: SessionRoleResult = {
  status: 'unassigned',
  role: null,
  memberKind: 'STAFF',
  hasStaffAccess: false,
  hasAdminAccess: false,
  staffAccessRequestStatus: 'PENDING',
  staffAccessRequestRejectionReason: null,
  selectedRole: 'STAFF',
  isProfileComplete: false,
  retry: () => {},
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSharedSessionRole', () => {
  it('제공된 스냅샷을 손대지 않고 그대로 돌려준다', () => {
    let received: SessionRoleResult | null = null;

    function Probe() {
      received = useSharedSessionRole();
      return null;
    }

    renderToStaticMarkup(
      <SessionRoleProvider value={SNAPSHOT}>
        <Probe />
      </SessionRoleProvider>,
    );

    expect(received).toBe(SNAPSHOT);
  });

  /**
   * 회귀 방지: 컨텍스트가 없을 때 스스로 `useSessionRole()`을 부르는 fallback을 두면
   * 조용히 두 번째 조회가 생기고, 게이트가 접근을 판단한 순간과 화면이 폼을 그리는
   * 순간이 갈린다. 조합이 잘못됐으면 조용히 넘어가는 대신 즉시 드러내야 한다.
   */
  it('게이트 밖에서 부르면 조용히 넘어가지 않고 던진다', () => {
    // React가 렌더 중 예외를 콘솔로도 알린다 — 테스트 출력만 조용히 시킨다.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    function Orphan() {
      useSharedSessionRole();
      return null;
    }

    expect(() => renderToStaticMarkup(<Orphan />)).toThrow(/RoleGate/);
  });
});
