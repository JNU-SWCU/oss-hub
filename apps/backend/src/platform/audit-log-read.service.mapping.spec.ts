import type { AuditSourceRow } from './audit-entry.types';
import {
  auditRow,
  occurredAt,
  state,
  people,
  lifecycle,
  visibility,
  decision,
  cases,
  readRows,
} from './audit-log-mapping.fixture';

const JOINED_PROGRAM: Readonly<Record<string, string>> = {
  PROGRAM: 'Current program',
  APPLICATION: 'Current application program',
};

const JOINED_ACTOR = {
  id: 'actor-id',
  name: 'Joined Actor',
  login: 'renamed-actor',
  role: 'ADMIN',
};

function row(
  metadata: unknown,
  targetType = 'USER',
  joined = true,
): AuditSourceRow {
  return auditRow({
    actor: JOINED_ACTOR,
    targetType,
    metadata,
    occurredAt,
    programName: joined ? (JOINED_PROGRAM[targetType] ?? null) : null,
    repositoryName:
      joined && targetType === 'REPOSITORY' ? 'current/repo' : null,
  });
}

describe('AuditLogReadService record mapping', () => {
  it.each(cases)(
    'returns target parts for $name',
    async ({ targetType, metadata, expectedTarget }) => {
      const result = await readRows([row(metadata, targetType)]);

      expect(result.items[0]?.target).toMatchObject({
        type: targetType,
        id: 'target',
        ...expectedTarget,
      });
    },
  );

  it.each(['PROGRAM', 'REPOSITORY'])(
    'returns a null %s name when the live target no longer exists',
    async (targetType) => {
      const result = await readRows([row({}, targetType, false)]);

      expect(result.items[0]?.target).toMatchObject({
        type: targetType,
        id: 'target',
        name: null,
      });
    },
  );

  it('passes the identities resolved by the feed query through unchanged', async () => {
    const metadata = {
      schemaVersion: 2,
      eventKind: 'DIRECT_ROLE_CHANGED',
      ...people,
      before: state,
      after: state,
    };
    const targetPerson = {
      name: 'Resolved Target',
      login: 'resolved-target',
      role: 'STUDENT',
    };

    const result = await readRows([
      auditRow({ actor: JOINED_ACTOR, targetPerson, metadata }),
    ]);

    expect(result.items[0]).toMatchObject({
      actor: JOINED_ACTOR,
      target: targetPerson,
      metadata,
      legacy: false,
    });
  });

  it('does not invent an actor for system histories', async () => {
    const result = await readRows([
      auditRow({
        action: 'GRANT_ADMIN_ACCESS',
        historyKind: 'BOOTSTRAP',
        category: 'SYSTEM',
        metadata: { schemaVersion: 1, recordKind: 'BOOTSTRAP' },
      }),
    ]);

    expect(result.items[0]).toMatchObject({
      actor: null,
      category: 'SYSTEM',
      target: { name: null, login: null },
    });
  });

  it('prefers the original snapshot over live names when an event contains one', async () => {
    const result = await readRows([
      row(
        { schemaVersion: 2, programName: 'Original program', ...lifecycle },
        'PROGRAM',
      ),
      row(
        {
          schemaVersion: 2,
          repositoryId: 'target',
          repositoryFullName: 'original/repo',
          ...visibility,
        },
        'REPOSITORY',
      ),
      row(
        {
          schemaVersion: 2,
          programName: 'Original program',
          applicantGithubLogin: 'original-applicant',
          ...decision,
        },
        'APPLICATION',
      ),
    ]);

    expect(
      result.items.map(({ target }) => [
        target.name,
        target.login,
        target.programName,
      ]),
    ).toEqual([
      ['Original program', null, null],
      ['original/repo', null, null],
      [null, null, 'Original program'],
    ]);
  });

  it('returns raw before/after codes from stored state transitions', async () => {
    const result = await readRows([
      row({ schemaVersion: 2, ...lifecycle }, 'PROGRAM'),
      row({ schemaVersion: 2, ...decision }, 'APPLICATION'),
      row(
        {
          schemaVersion: 2,
          eventKind: 'DIRECT_ROLE_CHANGED',
          ...people,
          before: { ...state, role: 'STUDENT' },
          after: state,
        },
        'USER',
      ),
      row({ schemaVersion: 2, programName: 'Original program' }, 'PROGRAM'),
    ]);

    expect(result.items.map((item) => item.change)).toEqual([
      { field: 'lifecycle', before: 'PUBLISHED', after: 'ARCHIVED' },
      { field: 'status', before: 'SUBMITTED', after: 'APPROVED' },
      { field: 'role', before: 'STUDENT', after: 'STAFF' },
      null,
    ]);
  });

  it('returns joined parts for legacy rows with no metadata', async () => {
    const result = await readRows(
      ['PROGRAM', 'REPOSITORY', 'APPLICATION'].map((type) => row({}, type)),
    );

    expect(
      result.items.map((item) => [
        item.target.name,
        item.target.programName,
        item.metadata,
      ]),
    ).toEqual([
      ['Current program', null, null],
      ['current/repo', null, null],
      [null, 'Current application program', null],
    ]);
  });

  it('keeps stored metadata for display and rejects it for an invalid phone transition', async () => {
    const stored = { schemaVersion: 1, transition: 'SET' };

    const result = await readRows([
      { ...row(stored), action: 'USER_PHONE_UPDATED' },
      {
        ...row({ schemaVersion: 1, transition: 'UNKNOWN' }),
        action: 'USER_PHONE_UPDATED',
      },
    ]);

    expect(result.items.map((item) => [item.legacy, item.metadata])).toEqual([
      [false, stored],
      [true, null],
    ]);
  });

  it.each([
    [
      { operation: 'LEAVE', previousLeaderId: 'a', nextLeaderId: 'a' },
      false,
      false,
    ],
    [
      { operation: 'LEAVE', previousLeaderId: 'a', nextLeaderId: 'b' },
      true,
      false,
    ],
    [
      { operation: 'REMOVE', previousLeaderId: 'a', nextLeaderId: null },
      false,
      true,
    ],
    [
      {
        operation: 'TRANSFER_LEADER',
        previousLeaderId: 'a',
        nextLeaderId: 'b',
      },
      true,
      false,
    ],
  ])(
    'decides team membership facts for %p',
    async (membership, leaderChanged, teamDeleted) => {
      const result = await readRows([
        auditRow({
          source: 'TEAM',
          category: 'OPERATION',
          action: 'TEAM_MEMBERSHIP_CHANGED',
          targetType: 'TEAM',
          metadata: { schemaVersion: 1, teamName: 'Team', ...membership },
        }),
      ]);

      expect(result.items[0]?.teamMembership).toEqual({
        operation: membership.operation,
        leaderChanged,
        teamDeleted,
      });
    },
  );

  it('omits team membership facts when the stored leader evidence is incomplete', async () => {
    const result = await readRows([
      auditRow({
        source: 'TEAM',
        action: 'TEAM_MEMBERSHIP_CHANGED',
        targetType: 'TEAM',
        metadata: { schemaVersion: 1, operation: 'LEAVE' },
      }),
    ]);

    expect(result.items[0]?.teamMembership).toBeNull();
  });

  it('maps submission and login sources into their own categories', async () => {
    const result = await readRows([
      auditRow({
        id: 'submission',
        source: 'SUBMISSION',
        category: 'SUBMISSION',
        action: 'SUBMISSION_RESUBMITTED',
        targetType: 'SUBMISSION',
        actor: JOINED_ACTOR,
        teamName: 'Joined team',
        programName: 'Joined program',
        metadata: {
          schemaVersion: 1,
          requirementName: 'Midterm report',
          revision: 2,
        },
      }),
      auditRow({
        id: 'login',
        source: 'LOGIN',
        category: 'LOGIN',
        action: 'LOGIN',
        actor: JOINED_ACTOR,
        targetPerson: {
          name: 'Joined Actor',
          login: 'renamed-actor',
          role: 'ADMIN',
        },
        metadata: { schemaVersion: 1, provider: 'github' },
      }),
    ]);

    expect(result.items).toEqual([
      expect.objectContaining({
        category: 'SUBMISSION',
        target: {
          type: 'SUBMISSION',
          id: 'target',
          name: 'Midterm report',
          login: null,
          role: null,
          programName: 'Joined program',
          teamName: 'Joined team',
        },
        change: { field: 'revision', before: null, after: '2' },
      }),
      expect.objectContaining({
        category: 'LOGIN',
        actor: JOINED_ACTOR,
        change: null,
      }),
    ]);
  });

  it('returns raw parts only, never Korean display strings', async () => {
    const result = await readRows([
      row({}, 'ROLE_REQUEST'),
      row({ schemaVersion: 2, ...lifecycle }, 'PROGRAM'),
      auditRow({ category: 'SYSTEM', metadata: {} }),
    ]);

    expect(JSON.stringify(result)).not.toMatch(
      /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/,
    );
  });

  it('returns the changed grant when the effective role stays the same', async () => {
    const before = {
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
    };

    const result = await readRows([
      auditRow({
        action: 'REVOKE_STAFF_ACCESS',
        metadata: {
          schemaVersion: 2,
          eventKind: 'INDEPENDENT_AUTHORITY_CHANGED',
          command: 'REVOKE_STAFF_ACCESS',
          before,
          after: { ...before, hasStaffAccess: false },
        },
      }),
    ]);

    expect(result.items[0]?.change).toEqual({
      field: 'hasStaffAccess',
      before: true,
      after: false,
    });
  });
});
