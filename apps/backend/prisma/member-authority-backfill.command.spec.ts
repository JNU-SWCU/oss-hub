import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import { applyMemberAuthorityBackfill } from './member-authority-backfill-core';
import { parseMemberAuthorityFixture } from './member-authority-backfill-fixture';
import type { MemberAuthorityBackfillUser } from './member-authority-backfill-types';

const repositoryRoot = resolve(__dirname, '../../..');
const fixturePath = resolve(
  __dirname,
  'fixtures/member-authority-62-users.json',
);

describe('member authority backfill command', () => {
  it('accepts a canonical student-admin without treating independent admin access as a legacy mismatch', () => {
    const user: MemberAuthorityBackfillUser = {
      id: 'synthetic-canonical-student-admin',
      githubId: '9990000001',
      nickname: 'synthetic-canonical-student-admin',
      role: Role.ADMIN,
      selectedRole: Role.STUDENT,
      selectedMemberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: true,
      name: '합성 학생 관리자',
      studentId: '790001',
      department: '합성 인공지능학부',
      profile: {
        name: '합성 학생 관리자',
        studentId: '790001',
        department: '합성 인공지능학부',
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: '합성 인공지능학부',
      },
    };

    expect(applyMemberAuthorityBackfill([user])).toMatchObject({
      changedUsers: 0,
      users: [{ role: Role.ADMIN, hasAdminAccess: true }],
    });
  });

  it('backfills the exact fixture and proves the second pass changes zero rows', () => {
    // Given
    const fixture = parseMemberAuthorityFixture(
      JSON.parse(readFileSync(fixturePath, 'utf8')),
    );
    expect(fixture.users.map(({ id }) => id)).toEqual([
      ...stableIds('student', 52),
      ...stableIds('staff', 3),
      ...stableIds('admin', 5),
      ...stableIds('unassigned', 2),
    ]);
    expect(fixture.users.map(({ githubId }) => githubId)).toEqual(
      Array.from({ length: 62 }, (_, index) => String(9_900_000_001 + index)),
    );
    expect(
      fixture.users
        .filter(({ role }) => role === null)
        .map(({ selectedRole, selectedMemberKind, profile }) => ({
          selectedRole,
          selectedMemberKind,
          memberKind: profile?.memberKind ?? null,
        })),
    ).toEqual([
      {
        selectedRole: Role.STUDENT,
        selectedMemberKind: null,
        memberKind: null,
      },
      {
        selectedRole: Role.STUDENT,
        selectedMemberKind: null,
        memberKind: null,
      },
    ]);
    expect(fixture.requests).toEqual([
      stableRequest(1, 'staff:001'),
      stableRequest(2, 'staff:002'),
      stableRequest(3, 'admin:001'),
      stableRequest(4, 'student:001'),
    ]);
    const evidenceRoot = mkdtempSync(
      join(tmpdir(), 'member-authority-backfill-'),
    );
    const evidencePath = join(evidenceRoot, 'backfill.json');

    try {
      // When
      const result = spawnSync(
        'pnpm',
        [
          '--filter',
          'backend',
          'db:backfill:member-authority',
          '--',
          '--fixture',
          'apps/backend/prisma/fixtures/member-authority-62-users.json',
          '--evidence',
          evidencePath,
        ],
        { cwd: repositoryRoot, encoding: 'utf8' },
      );

      // Then
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(evidencePath, 'utf8'))).toMatchObject({
        version: '20260821-member-authority-v1',
        fixture: {
          users: 62,
          legacyRoles: {
            STUDENT: 52,
            STAFF: 3,
            ADMIN: 5,
            UNASSIGNED: 2,
          },
          requests: 4,
        },
        firstRun: { changedUsers: 62 },
        secondRun: { changedUsers: 0, changedProfiles: 0 },
        aggregate: {
          selectedMemberKinds: {
            STUDENT: 54,
            STAFF: 3,
            UNRESOLVED: 5,
          },
          unassignedMemberKinds: {
            STUDENT: 0,
            STAFF: 0,
            UNRESOLVED: 2,
          },
        },
        preserved: {
          userIds: true,
          accountIds: true,
          requestHistory: true,
        },
      });
    } finally {
      rmSync(evidenceRoot, { recursive: true, force: true });
    }
  });
});

function stableIds(kind: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      `fixture:member-authority:user:${kind}:${String(index + 1).padStart(3, '0')}`,
  );
}

function stableRequest(index: number, userSuffix: string) {
  return {
    id: `fixture:member-authority:request:${String(index).padStart(3, '0')}`,
    userId: `fixture:member-authority:user:${userSuffix}`,
    status: 'APPROVED',
    decidedById: 'fixture:member-authority:user:admin:002',
  };
}
