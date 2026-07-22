import {
  buildRepositoryNames,
  GITHUB_REPOSITORY_NAME_MAX_LENGTH,
} from './repository-name';

describe('buildRepositoryNames', () => {
  it('영문 이름을 ASCII kebab-case 후보로 만든다', () => {
    // Given: 공백과 대문자가 포함된 프로그램·팀 이름이 있다.
    const input = {
      programName: 'Open Source Camp',
      programId: 'program-fixture-id',
      subjectName: 'Team Alpha',
      applicationId: 'application-fixture-id',
    };

    // When: 저장소 이름 후보를 계산한다.
    const result = buildRepositoryNames(input);

    // Then: 기본 이름과 충돌 fallback이 결정적으로 생성된다.
    expect(result).toEqual({
      preferred: 'open-source-camp-team-alpha',
      collisionFallback: 'open-source-camp-team-alpha-applicat',
    });
  });

  it('한글만 있는 이름은 stable id 앞 8자로 대체한다', () => {
    // Given: ASCII slug가 비는 프로그램·팀 이름이 있다.
    const input = {
      programName: '공개소프트웨어 경진대회',
      programId: 'programfixture123',
      subjectName: '한글팀',
      applicationId: 'applicationfixture456',
    };

    // When: 저장소 이름 후보를 계산한다.
    const result = buildRepositoryNames(input);

    // Then: stable id 기반 이름을 사용한다.
    expect(result).toEqual({
      preferred: 'program-programf-team-applicat',
      collisionFallback: 'program-programf-team-applicat-applicat',
    });
  });

  it('최대 길이에서도 충돌 suffix를 보존한다', () => {
    // Given: GitHub 이름 제한보다 긴 프로그램·팀 이름이 있다.
    const input = {
      programName: `program-${'a'.repeat(80)}`,
      programId: 'program-fixture-id',
      subjectName: `team-${'b'.repeat(80)}`,
      applicationId: 'application-fixture-id',
    };

    // When: 저장소 이름 후보를 계산한다.
    const result = buildRepositoryNames(input);

    // Then: 두 후보가 제한을 넘지 않고 fallback suffix는 유지된다.
    expect(result.preferred.length).toBeLessThanOrEqual(
      GITHUB_REPOSITORY_NAME_MAX_LENGTH,
    );
    expect(result.collisionFallback.length).toBeLessThanOrEqual(
      GITHUB_REPOSITORY_NAME_MAX_LENGTH,
    );
    expect(result.collisionFallback).toMatch(/-applicat$/);
  });
});
