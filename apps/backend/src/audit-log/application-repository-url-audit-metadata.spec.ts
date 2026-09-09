import {
  InvalidAuditLogMetadataError,
  parseAuditLogMetadata,
} from './audit-log-metadata';

describe('application repository URL audit', () => {
  const metadata = {
    schemaVersion: 1,
    programId: 'program',
    teamId: 'team',
    programName: 'Program',
    before: {
      repositoryId: 'old',
      repositoryUrl: 'https://github.com/org/old',
    },
    after: {
      repositoryId: 'new',
      repositoryUrl: 'https://github.com/org/new',
    },
    reason: 'Project moved',
    actorGithubLogin: 'student',
  };

  it('preserves the committed repository identities and reason', () => {
    const result = parseAuditLogMetadata(metadata);
    expect(result).toEqual({ legacy: false, metadata });
  });

  it.each([251, 500])(
    'accepts a reason with %i astral characters',
    (length) => {
      // Given
      const input = { ...metadata, reason: '😀'.repeat(length) };
      // When
      const result = parseAuditLogMetadata(input);
      // Then
      expect(result).toEqual({ legacy: false, metadata: input });
    },
  );

  it('rejects a reason with 501 astral characters', () => {
    // Given
    const input = { ...metadata, reason: '😀'.repeat(501) };
    // When
    const parse = () => parseAuditLogMetadata(input);
    // Then
    expect(parse).toThrow(InvalidAuditLogMetadataError);
  });
});
