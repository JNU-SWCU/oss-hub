import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SessionRoleProvider,
  useSharedSessionRole,
} from './session-role-context';
import type { SessionRoleResult } from './use-session-role';

const SNAPSHOT: SessionRoleResult = {
  status: 'unassigned',
  memberKind: null,
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

  it('게이트 밖에서 부르면 조용히 넘어가지 않고 던진다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    function Orphan() {
      useSharedSessionRole();
      return null;
    }

    expect(() => renderToStaticMarkup(<Orphan />)).toThrow(/RoleGate/);
  });
});
