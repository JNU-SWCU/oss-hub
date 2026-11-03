import { describe, expect, it } from 'vitest';
import { programScopeViewerRole } from './program-shell-policy';

const identities = [
  {
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    viewerRole: 'STUDENT',
  },
  {
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: true,
    viewerRole: 'STUDENT',
  },
  {
    memberKind: 'STUDENT',
    hasStaffAccess: true,
    hasAdminAccess: true,
    viewerRole: 'STUDENT',
  },
  {
    memberKind: 'STAFF',
    hasStaffAccess: false,
    hasAdminAccess: true,
    viewerRole: 'GUEST',
  },
  {
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: false,
    viewerRole: 'STAFF',
  },
  {
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: true,
    viewerRole: 'STAFF',
  },
  {
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: true,
    viewerRole: 'GUEST',
  },
] as const;

describe.each(identities)('program access for %j', (authority) => {
  it('uses the actual identity for the program workspace', () => {
    expect(programScopeViewerRole(true, authority)).toBe(authority.viewerRole);
  });

  it('does not open member tools to an inactive session', () => {
    expect(programScopeViewerRole(false, authority)).toBe('GUEST');
  });
});
