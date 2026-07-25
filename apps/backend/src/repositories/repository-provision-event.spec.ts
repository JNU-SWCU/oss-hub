import {
  InvalidRepositoryProvisionEventError,
  parseRepositoryProvisionEvent,
} from './repository-provision-event';

describe('parseRepositoryProvisionEvent', () => {
  it('승인 시점 collaborator snapshot을 typed event로 파싱한다', () => {
    // Given: #119가 남긴 유효한 개인형 payload가 있다.
    const payload = {
      applicationId: 'application-fixture-id',
      programId: 'program-fixture-id',
      teamId: null,
      requestedAt: '2026-07-22T00:00:00.000Z',
      collaboratorGithubLogins: ['student-a', 'student-b'],
    };

    // When: outbox payload를 신뢰 경계에서 파싱한다.
    const result = parseRepositoryProvisionEvent(payload);

    // Then: nullable team과 snapshot 순서를 보존한다.
    expect(result).toEqual(payload);
  });

  it.each([
    [{ applicationId: 'application-fixture-id' }],
    [
      {
        applicationId: 'application-fixture-id',
        programId: 'program-fixture-id',
        teamId: null,
        requestedAt: 'invalid-date',
        collaboratorGithubLogins: ['student-a'],
      },
    ],
    [
      {
        applicationId: 'application-fixture-id',
        programId: 'program-fixture-id',
        teamId: null,
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['student-b', 'student-a'],
      },
    ],
    [
      {
        applicationId: 'application-fixture-id',
        programId: 'program-fixture-id',
        teamId: null,
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['Student-A'],
      },
    ],
  ])('불완전하거나 비정규화된 payload %p를 거부한다', (payload) => {
    // When: 계약 밖 payload를 파싱한다.
    const parse = (): void => {
      parseRepositoryProvisionEvent(payload);
    };

    // Then: 내부 타입으로 통과시키지 않는다.
    expect(parse).toThrow(InvalidRepositoryProvisionEventError);
  });
});
