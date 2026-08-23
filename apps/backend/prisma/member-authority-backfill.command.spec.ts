import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AffiliationKind, MemberKind, Role } from '@prisma/client';
import {
  applyMemberAuthorityBackfill,
  MemberAuthorityBackfillInvariantError,
} from './member-authority-backfill-core';
import { parseMemberAuthorityFixture } from './member-authority-backfill-fixture';
import type { MemberAuthorityBackfillUser } from './member-authority-backfill-types';

const repositoryRoot = resolve(__dirname, '../../..');
const fixturePath = resolve(
  __dirname,
  'fixtures/member-authority-62-users.json',
);

describe('member authority backfill command', () => {
  it('rejects an opposite retained selection on a canonical student-admin', () => {
    const user: MemberAuthorityBackfillUser = {
      id: 'synthetic-canonical-student-admin',
      githubId: '9990000001',
      nickname: 'synthetic-canonical-student-admin',
      role: Role.ADMIN,
      selectedRole: Role.STAFF,
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

    expectUnknownSelection(user);
  });

  it('logs only aggregate invariant kind and count on CLI failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'member-authority-failure-'));
    const inputPath = join(root, 'fixture.json');
    const evidencePath = join(root, 'evidence.json');
    const fixture = parseMemberAuthorityFixture(
      JSON.parse(readFileSync(fixturePath, 'utf8')),
    );
    const source = fixture.users[0];
    if (source === undefined || source.profile === null) {
      throw new TypeError('Missing synthetic failure fixture');
    }
    const input = {
      version: 1,
      users: [
        {
          ...source,
          selectedRole: Role.STUDENT,
          selectedMemberKind: MemberKind.STAFF,
          hasStaffAccess: false,
          hasAdminAccess: false,
          profile: { ...source.profile, memberKind: MemberKind.STUDENT },
        },
      ],
      requests: [],
    };
    writeFileSync(inputPath, JSON.stringify(input));

    try {
      const result = spawnFixture(inputPath, evidencePath);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'failed kind=UNKNOWN_SELECTION_COMBINATION count=1',
      );
      expect(result.stderr).not.toContain(source.id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
        .filter(({ id }) =>
          [
            'fixture:member-authority:user:student:001',
            'fixture:member-authority:user:student:002',
            'fixture:member-authority:user:admin:001',
          ].includes(id),
        )
        .map(({ id, role, selectedRole }) => ({
          id,
          role,
          selectedRole,
          approved: fixture.requests.some(
            (request) => request.userId === id && request.status === 'APPROVED',
          ),
        })),
    ).toEqual([
      {
        id: 'fixture:member-authority:user:student:001',
        role: Role.STUDENT,
        selectedRole: Role.STAFF,
        approved: true,
      },
      {
        id: 'fixture:member-authority:user:student:002',
        role: Role.STUDENT,
        selectedRole: Role.STAFF,
        approved: false,
      },
      {
        id: 'fixture:member-authority:user:admin:001',
        role: Role.ADMIN,
        selectedRole: Role.STAFF,
        approved: true,
      },
    ]);
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
      const result = spawnFixture(
        'apps/backend/prisma/fixtures/member-authority-62-users.json',
        evidencePath,
      );

      // Then
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(evidencePath, 'utf8'))).toMatchObject({
        version: '20260822-member-authority-v2',
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

function expectUnknownSelection(user: MemberAuthorityBackfillUser): void {
  try {
    applyMemberAuthorityBackfill([user]);
    throw new Error('Expected selection invariant failure');
  } catch (error: unknown) {
    if (!(error instanceof MemberAuthorityBackfillInvariantError)) throw error;
    expect(error.kind).toBe('UNKNOWN_SELECTION_COMBINATION');
  }
}

function spawnFixture(inputPath: string, evidencePath: string) {
  return spawnSync(
    'pnpm',
    [
      '--filter',
      'backend',
      'db:backfill:member-authority',
      '--',
      '--fixture',
      inputPath,
      '--evidence',
      evidencePath,
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
}

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
