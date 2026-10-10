import {
  buildRepositoryNames,
  buildRepositoryOwnershipMarker,
  GITHUB_REPOSITORY_NAME_MAX_LENGTH,
} from './repository-name';

describe('buildRepositoryNames', () => {
  it('영문 이름을 ASCII kebab-case 후보로 만든다', () => {
    const input = {
      programName: 'Open Source Camp',
      programId: 'program-fixture-id',
      subjectName: 'Team Alpha',
      applicationId: 'application-fixture-id',
    };

    const result = buildRepositoryNames(input);

    expect(result).toEqual({
      preferred: 'open-source-camp-team-alpha',
      collisionFallback: 'open-source-camp-team-alpha-applicat',
    });
  });

  it('한글만 있는 이름은 stable id 앞 8자로 대체한다', () => {
    const input = {
      programName: '공개소프트웨어 경진대회',
      programId: 'programfixture123',
      subjectName: '한글팀',
      applicationId: 'applicationfixture456',
    };

    const result = buildRepositoryNames(input);

    expect(result).toEqual({
      preferred: 'program-programf-team-applicat',
      collisionFallback: 'program-programf-team-applicat-applicat',
    });
  });

  it('최대 길이에서도 충돌 suffix를 보존한다', () => {
    const input = {
      programName: `program-${'a'.repeat(80)}`,
      programId: 'program-fixture-id',
      subjectName: `team-${'b'.repeat(80)}`,
      applicationId: 'application-fixture-id',
    };

    const result = buildRepositoryNames(input);

    expect(result.preferred.length).toBeLessThanOrEqual(
      GITHUB_REPOSITORY_NAME_MAX_LENGTH,
    );
    expect(result.collisionFallback.length).toBeLessThanOrEqual(
      GITHUB_REPOSITORY_NAME_MAX_LENGTH,
    );
    expect(result.collisionFallback).toMatch(/-applicat$/);
  });
});

describe('buildRepositoryOwnershipMarker', () => {
  it('application ID를 노출하지 않는 결정적 marker를 만든다', () => {
    const applicationId = 'application-sensitive-fixture-id';

    const first = buildRepositoryOwnershipMarker(applicationId);
    const repeated = buildRepositoryOwnershipMarker(applicationId);
    const different = buildRepositoryOwnershipMarker('other-application-id');

    expect(first).toBe(repeated);
    expect(first).not.toBe(different);
    expect(first).not.toContain(applicationId);
    expect(first).toMatch(/^oss-hub:[a-f0-9]{64}$/);
  });
});
