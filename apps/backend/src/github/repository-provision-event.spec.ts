import {
  InvalidRepositoryProvisionEventError,
  REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
  REPOSITORY_PROVISION_EVENT_TYPE,
  parseRepositoryAccessSyncEvent,
  parseRepositoryProvisionEvent,
  repositoryAccessSyncEventData,
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

    // Then: nullable team과 snapshot 순서를 보존하고, 레거시 row는 NEW + null로 정규화한다.
    expect(result).toEqual({
      ...payload,
      repositoryConnectionMode: 'NEW',
      repositoryUrl: null,
    });
  });

  it('OWN 연결 payload는 repositoryUrl을 보존한다', () => {
    const payload = {
      applicationId: 'application-fixture-id',
      programId: 'program-fixture-id',
      teamId: null,
      requestedAt: '2026-07-22T00:00:00.000Z',
      collaboratorGithubLogins: ['student-a'],
      repositoryConnectionMode: 'OWN',
      repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
    };

    expect(parseRepositoryProvisionEvent(payload)).toEqual(payload);
  });

  it('NEW + null repositoryUrl payload를 허용한다', () => {
    const payload = {
      applicationId: 'application-fixture-id',
      programId: 'program-fixture-id',
      teamId: null,
      requestedAt: '2026-07-22T00:00:00.000Z',
      collaboratorGithubLogins: ['student-a'],
      repositoryConnectionMode: 'NEW',
      repositoryUrl: null,
    };

    expect(parseRepositoryProvisionEvent(payload)).toEqual(payload);
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
    [
      {
        applicationId: 'application-fixture-id',
        programId: 'program-fixture-id',
        teamId: null,
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['student-a'],
        repositoryConnectionMode: 'NEW',
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      },
    ],
    [
      {
        applicationId: 'application-fixture-id',
        programId: 'program-fixture-id',
        teamId: null,
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['student-a'],
        repositoryConnectionMode: 'OWN',
        repositoryUrl: null,
      },
    ],
    [
      {
        applicationId: 'application-fixture-id',
        programId: 'program-fixture-id',
        teamId: null,
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['student-a'],
        repositoryConnectionMode: 'OWN',
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

const SYNC_APPLICATION_ID = 'access-sync-application-id';
const SYNC_TEAM_ID = 'access-sync-team-id';
const SYNC_NOW = new Date('2026-09-01T12:34:56.789Z');
const SYNC_REQUESTED_AT = '2026-09-01T12:34:56.789Z';

describe('repositoryAccessSyncEventData', () => {
  it('세 인자만으로 outbox row 전체를 결정한다', () => {
    // When: 구성원 변경 트랜잭션이 예약할 row 를 만든다.
    const row = repositoryAccessSyncEventData(
      SYNC_APPLICATION_ID,
      SYNC_TEAM_ID,
      SYNC_NOW,
    );

    // Then: consumer 가 읽는 열이 모두 채워지고 payload 는 세 key 뿐이다.
    expect(row).toEqual({
      type: REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
      aggregateType: 'Application',
      aggregateId: SYNC_APPLICATION_ID,
      idempotencyKey: `repository-access-sync:${SYNC_APPLICATION_ID}:${SYNC_REQUESTED_AT}`,
      payload: {
        applicationId: SYNC_APPLICATION_ID,
        teamId: SYNC_TEAM_ID,
        requestedAt: SYNC_REQUESTED_AT,
      },
      availableAt: SYNC_NOW,
    });
    // provision 요청과 같은 queue 를 쓰지만 type 은 절대 겹치지 않는다.
    expect(row.type).not.toBe(REPOSITORY_PROVISION_EVENT_TYPE);
  });

  it('호출 시점 wall clock 이 아니라 넘겨받은 시각에만 묶인다', () => {
    // Given: 시스템 시계를 인자와 전혀 다른 시각으로 돌려 둔다.
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      // When
      const row = repositoryAccessSyncEventData(
        SYNC_APPLICATION_ID,
        SYNC_TEAM_ID,
        SYNC_NOW,
      );

      // Then: 트랜잭션이 정한 시각만 남는다 — 시계를 읽었다면 2030 이 새어 나온다.
      expect(row.availableAt).toEqual(SYNC_NOW);
      expect(row.idempotencyKey).toBe(
        `repository-access-sync:${SYNC_APPLICATION_ID}:${SYNC_REQUESTED_AT}`,
      );
      expect(parseRepositoryAccessSyncEvent(row.payload).requestedAt).toBe(
        SYNC_REQUESTED_AT,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('같은 신청·같은 시각만 한 key 로 합치고 이후 변경은 새 row 가 된다', () => {
    const first = repositoryAccessSyncEventData(
      SYNC_APPLICATION_ID,
      SYNC_TEAM_ID,
      SYNC_NOW,
    );
    const sameInstant = repositoryAccessSyncEventData(
      SYNC_APPLICATION_ID,
      SYNC_TEAM_ID,
      new Date(SYNC_NOW.getTime()),
    );
    const oneMillisecondLater = repositoryAccessSyncEventData(
      SYNC_APPLICATION_ID,
      SYNC_TEAM_ID,
      new Date(SYNC_NOW.getTime() + 1),
    );
    const otherApplication = repositoryAccessSyncEventData(
      'other-application-id',
      SYNC_TEAM_ID,
      SYNC_NOW,
    );

    expect(sameInstant.idempotencyKey).toBe(first.idempotencyKey);
    expect(oneMillisecondLater.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(otherApplication.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});

describe('parseRepositoryAccessSyncEvent', () => {
  it('factory 가 만든 payload 를 그대로 왕복한다', () => {
    const { payload } = repositoryAccessSyncEventData(
      SYNC_APPLICATION_ID,
      SYNC_TEAM_ID,
      SYNC_NOW,
    );

    expect(parseRepositoryAccessSyncEvent(payload)).toEqual({
      applicationId: SYNC_APPLICATION_ID,
      teamId: SYNC_TEAM_ID,
      requestedAt: SYNC_REQUESTED_AT,
    });
  });

  it.each([
    ['비객체', 'access-sync'],
    ['null', null],
    ['배열', []],
    [
      'teamId 누락',
      {
        applicationId: SYNC_APPLICATION_ID,
        requestedAt: SYNC_REQUESTED_AT,
      },
    ],
    [
      'teamId null — 권한 동기화는 팀이 반드시 있다',
      {
        applicationId: SYNC_APPLICATION_ID,
        teamId: null,
        requestedAt: SYNC_REQUESTED_AT,
      },
    ],
    [
      '빈 applicationId',
      {
        applicationId: '',
        teamId: SYNC_TEAM_ID,
        requestedAt: SYNC_REQUESTED_AT,
      },
    ],
    [
      '공백이 붙은 teamId',
      {
        applicationId: SYNC_APPLICATION_ID,
        teamId: ` ${SYNC_TEAM_ID} `,
        requestedAt: SYNC_REQUESTED_AT,
      },
    ],
    [
      '정규 ISO 가 아닌 requestedAt',
      {
        applicationId: SYNC_APPLICATION_ID,
        teamId: SYNC_TEAM_ID,
        requestedAt: '2026-09-01T12:34:56Z',
      },
    ],
    [
      '파싱 불가 requestedAt',
      {
        applicationId: SYNC_APPLICATION_ID,
        teamId: SYNC_TEAM_ID,
        requestedAt: 'yesterday',
      },
    ],
    [
      '계약 밖 key 가 섞인 payload',
      {
        applicationId: SYNC_APPLICATION_ID,
        teamId: SYNC_TEAM_ID,
        requestedAt: SYNC_REQUESTED_AT,
        collaboratorGithubLogins: ['student-a'],
      },
    ],
  ])('%s payload 를 거부한다', (_label, payload) => {
    const parse = (): void => {
      parseRepositoryAccessSyncEvent(payload);
    };

    expect(parse).toThrow(InvalidRepositoryProvisionEventError);
  });

  /**
   * 두 이벤트는 같은 outbox 를 공유하므로 payload 를 서로 통과시키면
   * worker 가 엉뚱한 작업을 한다. 양쪽 모두 상대 payload 를 거부해야 한다.
   */
  it('provision payload 와 access sync payload 를 서로 통과시키지 않는다', () => {
    const provisionPayload = {
      applicationId: SYNC_APPLICATION_ID,
      programId: 'program-fixture-id',
      teamId: SYNC_TEAM_ID,
      requestedAt: SYNC_REQUESTED_AT,
      collaboratorGithubLogins: ['student-a'],
    };
    const { payload: accessSyncPayload } = repositoryAccessSyncEventData(
      SYNC_APPLICATION_ID,
      SYNC_TEAM_ID,
      SYNC_NOW,
    );

    expect(() => parseRepositoryAccessSyncEvent(provisionPayload)).toThrow(
      InvalidRepositoryProvisionEventError,
    );
    expect(() => parseRepositoryProvisionEvent(accessSyncPayload)).toThrow(
      InvalidRepositoryProvisionEventError,
    );
  });
});
