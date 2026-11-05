import { InvalidRepositoryProvisionEventError } from './repositories.error';
import { REPOSITORY_PROVISION_EVENT_TYPE } from './repository-provision-event.config';
import { REPOSITORY_ACCESS_SYNC_EVENT_TYPE } from '../platform/repository-access-sync.config';
import { PlatformRepository } from '../platform/platform.repository';
import { RepositoryProvisionEventService } from './repository-provision-event.service';

const repositoryProvisionEventService = new RepositoryProvisionEventService();

describe('parseRepositoryProvisionEvent', () => {
  it('승인 시점 collaborator snapshot을 typed event로 파싱한다', () => {
    const payload = {
      teamId: 'application-fixture-id',
      programId: 'program-fixture-id',
      requestedAt: '2026-07-22T00:00:00.000Z',
      collaboratorGithubLogins: ['student-a', 'student-b'],
    };

    const result =
      repositoryProvisionEventService.parseRepositoryProvisionEvent(payload);

    expect(result).toEqual({
      ...payload,
      repositoryConnectionMode: 'NEW',
      repositoryUrl: null,
    });
  });

  it('OWN 연결 payload는 repositoryUrl을 보존한다', () => {
    const payload = {
      teamId: 'application-fixture-id',
      programId: 'program-fixture-id',
      requestedAt: '2026-07-22T00:00:00.000Z',
      collaboratorGithubLogins: ['student-a'],
      repositoryConnectionMode: 'OWN',
      repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
    };

    expect(
      repositoryProvisionEventService.parseRepositoryProvisionEvent(payload),
    ).toEqual(payload);
  });

  it('NEW + null repositoryUrl payload를 허용한다', () => {
    const payload = {
      teamId: 'application-fixture-id',
      programId: 'program-fixture-id',
      requestedAt: '2026-07-22T00:00:00.000Z',
      collaboratorGithubLogins: ['student-a'],
      repositoryConnectionMode: 'NEW',
      repositoryUrl: null,
    };

    expect(
      repositoryProvisionEventService.parseRepositoryProvisionEvent(payload),
    ).toEqual(payload);
  });

  it.each([
    [{ teamId: 'application-fixture-id' }],
    [
      {
        teamId: 'application-fixture-id',
        programId: 'program-fixture-id',
        requestedAt: 'invalid-date',
        collaboratorGithubLogins: ['student-a'],
      },
    ],
    [
      {
        teamId: 'application-fixture-id',
        programId: 'program-fixture-id',
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['student-b', 'student-a'],
      },
    ],
    [
      {
        teamId: 'application-fixture-id',
        programId: 'program-fixture-id',
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['Student-A'],
      },
    ],
    [
      {
        teamId: 'application-fixture-id',
        programId: 'program-fixture-id',
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['student-a'],
        repositoryConnectionMode: 'NEW',
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      },
    ],
    [
      {
        teamId: 'application-fixture-id',
        programId: 'program-fixture-id',
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['student-a'],
        repositoryConnectionMode: 'OWN',
        repositoryUrl: null,
      },
    ],
    [
      {
        teamId: 'application-fixture-id',
        programId: 'program-fixture-id',
        requestedAt: '2026-07-22T00:00:00.000Z',
        collaboratorGithubLogins: ['student-a'],
        repositoryConnectionMode: 'OWN',
      },
    ],
  ])('불완전하거나 비정규화된 payload %p를 거부한다', (payload) => {
    const parse = (): void => {
      repositoryProvisionEventService.parseRepositoryProvisionEvent(payload);
    };

    expect(parse).toThrow(InvalidRepositoryProvisionEventError);
  });
});

const SYNC_TEAM_ID = 'access-sync-team-id';
const SYNC_NOW = new Date('2026-09-01T12:34:56.789Z');
const SYNC_REQUESTED_AT = '2026-09-01T12:34:56.789Z';

describe('repositoryAccessSyncEventData', () => {
  it('팀 ID와 시각으로 outbox row 전체를 결정한다', () => {
    const row = new PlatformRepository().repositoryAccessSyncEventData(
      SYNC_TEAM_ID,
      SYNC_NOW,
    );

    expect(row).toEqual({
      type: REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
      aggregateType: 'Team',
      aggregateId: SYNC_TEAM_ID,
      idempotencyKey: `repository-access-sync:${SYNC_TEAM_ID}:${SYNC_REQUESTED_AT}`,
      payload: {
        teamId: SYNC_TEAM_ID,
        requestedAt: SYNC_REQUESTED_AT,
      },
      availableAt: SYNC_NOW,
    });

    expect(row.type).not.toBe(REPOSITORY_PROVISION_EVENT_TYPE);
  });

  it('호출 시점 wall clock 이 아니라 넘겨받은 시각에만 묶인다', () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const row = new PlatformRepository().repositoryAccessSyncEventData(
        SYNC_TEAM_ID,
        SYNC_NOW,
      );

      expect(row.availableAt).toEqual(SYNC_NOW);
      expect(row.idempotencyKey).toBe(
        `repository-access-sync:${SYNC_TEAM_ID}:${SYNC_REQUESTED_AT}`,
      );
      expect(
        repositoryProvisionEventService.parseRepositoryAccessSyncEvent(
          row.payload,
        ).requestedAt,
      ).toBe(SYNC_REQUESTED_AT);
    } finally {
      jest.useRealTimers();
    }
  });

  it('같은 신청·같은 시각만 한 key 로 합치고 이후 변경은 새 row 가 된다', () => {
    const first = new PlatformRepository().repositoryAccessSyncEventData(
      SYNC_TEAM_ID,
      SYNC_NOW,
    );
    const sameInstant = new PlatformRepository().repositoryAccessSyncEventData(
      SYNC_TEAM_ID,
      new Date(SYNC_NOW.getTime()),
    );
    const oneMillisecondLater =
      new PlatformRepository().repositoryAccessSyncEventData(
        SYNC_TEAM_ID,
        new Date(SYNC_NOW.getTime() + 1),
      );
    const otherApplication =
      new PlatformRepository().repositoryAccessSyncEventData(
        'other-application-id',
        SYNC_NOW,
      );

    expect(sameInstant.idempotencyKey).toBe(first.idempotencyKey);
    expect(oneMillisecondLater.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(otherApplication.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});

describe('parseRepositoryAccessSyncEvent', () => {
  it('factory 가 만든 payload 를 그대로 왕복한다', () => {
    const { payload } = new PlatformRepository().repositoryAccessSyncEventData(
      SYNC_TEAM_ID,
      SYNC_NOW,
    );

    expect(
      repositoryProvisionEventService.parseRepositoryAccessSyncEvent(payload),
    ).toEqual({
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
        requestedAt: SYNC_REQUESTED_AT,
      },
    ],
    [
      'teamId null — 권한 동기화는 팀이 반드시 있다',
      {
        teamId: null,
        requestedAt: SYNC_REQUESTED_AT,
      },
    ],
    [
      '빈 teamId',
      {
        teamId: '',
        requestedAt: SYNC_REQUESTED_AT,
      },
    ],
    [
      '공백이 붙은 teamId',
      {
        teamId: ` ${SYNC_TEAM_ID} `,
        requestedAt: SYNC_REQUESTED_AT,
      },
    ],
    [
      '정규 ISO 가 아닌 requestedAt',
      {
        teamId: SYNC_TEAM_ID,
        requestedAt: '2026-09-01T12:34:56Z',
      },
    ],
    [
      '파싱 불가 requestedAt',
      {
        teamId: SYNC_TEAM_ID,
        requestedAt: 'yesterday',
      },
    ],
    [
      '계약 밖 key 가 섞인 payload',
      {
        teamId: SYNC_TEAM_ID,
        requestedAt: SYNC_REQUESTED_AT,
        collaboratorGithubLogins: ['student-a'],
      },
    ],
  ])('%s payload 를 거부한다', (_label, payload) => {
    const parse = (): void => {
      repositoryProvisionEventService.parseRepositoryAccessSyncEvent(payload);
    };

    expect(parse).toThrow(InvalidRepositoryProvisionEventError);
  });

  it('provision payload 와 access sync payload 를 서로 통과시키지 않는다', () => {
    const provisionPayload = {
      teamId: SYNC_TEAM_ID,
      programId: 'program-fixture-id',
      requestedAt: SYNC_REQUESTED_AT,
      collaboratorGithubLogins: ['student-a'],
    };
    const { payload: accessSyncPayload } =
      new PlatformRepository().repositoryAccessSyncEventData(
        SYNC_TEAM_ID,
        SYNC_NOW,
      );

    expect(() =>
      repositoryProvisionEventService.parseRepositoryAccessSyncEvent(
        provisionPayload,
      ),
    ).toThrow(InvalidRepositoryProvisionEventError);
    expect(() =>
      repositoryProvisionEventService.parseRepositoryProvisionEvent(
        accessSyncPayload,
      ),
    ).toThrow(InvalidRepositoryProvisionEventError);
  });
});
