import {
  createUserProfileAuditMetadata,
  InvalidAuditLogMetadataError,
  parseAuditLogMetadata,
  USER_PROFILE_AUDIT_FIELDS,
} from './audit-log-metadata';

const ACTOR = {
  displayName: '합성 관리자',
  githubLogin: 'synthetic-admin',
} as const;
const TARGET = {
  displayName: '합성 교직원',
  githubLogin: 'synthetic-target',
} as const;

it('round-trips a staff-number profile field change', () => {
  expect(USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER).toBe('staffNumber');

  const metadata = createUserProfileAuditMetadata({
    actor: ACTOR,
    target: TARGET,
    changes: [
      {
        field: USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER,
        before: null,
        after: 'staff-2026-001',
      },
    ],
  });

  expect(parseAuditLogMetadata(JSON.parse(JSON.stringify(metadata)))).toEqual({
    legacy: false,
    metadata,
  });
});

it.each([
  [
    'member kind is not a profile field',
    (metadata: ProfileMetadataFixture) => ({
      ...metadata,
      changes: [
        {
          field: 'memberKind',
          before: null,
          after: 'staff-2026-001',
        },
      ],
    }),
  ],
  [
    'staff number must be a string or null',
    (metadata: ProfileMetadataFixture) => ({
      ...metadata,
      changes: [
        {
          field: USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER,
          before: 123,
          after: 'staff-2026-001',
        },
      ],
    }),
  ],
  [
    'field changes reject extra keys',
    (metadata: ProfileMetadataFixture) => ({
      ...metadata,
      changes: [
        {
          field: USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER,
          before: 'staff-2025-009',
          after: 'staff-2026-001',
          source: 'member-kind-form',
        },
      ],
    }),
  ],
] as const)('rejects malformed profile metadata when %s', (_name, mutate) => {
  const metadata = createUserProfileAuditMetadata({
    actor: ACTOR,
    target: TARGET,
    changes: [
      {
        field: USER_PROFILE_AUDIT_FIELDS.STAFF_NUMBER,
        before: 'staff-2025-009',
        after: 'staff-2026-001',
      },
    ],
  });

  expect(() => parseAuditLogMetadata(mutate(metadata))).toThrow(
    InvalidAuditLogMetadataError,
  );
});

type ProfileMetadataFixture = ReturnType<typeof createUserProfileAuditMetadata>;
