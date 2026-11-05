import { HistoryMetadataService } from './history-metadata.service';

const historyMetadataService = new HistoryMetadataService();

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
    const result =
      historyMetadataService.parseApplicationRepositoryUrlAuditMetadata(
        metadata,
      );
    expect(result).toEqual(metadata);
  });

  it('reads current reasonless events without losing committed identities', () => {
    const current = {
      schemaVersion: 2,
      programId: metadata.programId,
      teamId: metadata.teamId,
      programName: metadata.programName,
      actorGithubLogin: metadata.actorGithubLogin,
      before: metadata.before,
      after: metadata.after,
    };
    expect(
      historyMetadataService.parseApplicationRepositoryUrlAuditMetadata(
        current,
      ),
    ).toEqual(current);
    expect(current).not.toHaveProperty('reason');
  });

  it.each([251, 500])(
    'accepts a reason with %i astral characters',
    (length) => {
      const input = { ...metadata, reason: '😀'.repeat(length) };

      const result =
        historyMetadataService.parseApplicationRepositoryUrlAuditMetadata(
          input,
        );

      expect(result).toEqual(input);
    },
  );

  it('rejects a reason with 501 astral characters', () => {
    const input = { ...metadata, reason: '😀'.repeat(501) };

    const result =
      historyMetadataService.parseApplicationRepositoryUrlAuditMetadata(input);

    expect(result).toBeNull();
  });
});
