import {
  assertIsolatedIntegrationDatabase,
  IntegrationDatabaseGuardError,
  INTEGRATION_RUNNER_SENTINEL,
} from '../../test/integration-database.guard';
import type { IntegrationDatabaseEnvironment } from '../../test/integration-database.guard';

const isolatedEnvironment = {
  databaseUrl:
    'postgresql://oss:oss-dev@127.0.0.1:49152/oss_hub_test?schema=public',
  runnerSentinel: INTEGRATION_RUNNER_SENTINEL,
} as const satisfies IntegrationDatabaseEnvironment;

const rejectedEnvironments = [
  {
    name: 'runner 표식이 없을 때',
    environment: { ...isolatedEnvironment, runnerSentinel: undefined },
  },
  {
    name: 'runner 표식이 다를 때',
    environment: { ...isolatedEnvironment, runnerSentinel: 'other-runner' },
  },
  {
    name: '외부 호스트를 가리킬 때',
    environment: {
      ...isolatedEnvironment,
      databaseUrl:
        'postgresql://oss:oss-dev@database.invalid:5432/oss_hub_test?schema=public',
    },
  },
  {
    name: 'localhost 별칭을 사용할 때',
    environment: {
      ...isolatedEnvironment,
      databaseUrl:
        'postgresql://oss:oss-dev@localhost:5432/oss_hub_test?schema=public',
    },
  },
  {
    name: '테스트 DB 이름이 다를 때',
    environment: {
      ...isolatedEnvironment,
      databaseUrl:
        'postgresql://oss:oss-dev@127.0.0.1:5432/oss_hub?schema=public',
    },
  },
  {
    name: '게시 포트가 없을 때',
    environment: {
      ...isolatedEnvironment,
      databaseUrl:
        'postgresql://oss:oss-dev@127.0.0.1/oss_hub_test?schema=public',
    },
  },
  {
    name: 'URL 형식이 아닐 때',
    environment: {
      ...isolatedEnvironment,
      databaseUrl: 'not-a-database-url',
    },
  },
  {
    name: 'query parameter가 socket host를 덮어쓸 때',
    environment: {
      ...isolatedEnvironment,
      databaseUrl:
        'postgresql://oss:oss-dev@127.0.0.1:5432/oss_hub_test?host=%2Fvar%2Frun%2Fpostgresql&schema=public',
    },
  },
  {
    name: 'schema가 public이 아닐 때',
    environment: {
      ...isolatedEnvironment,
      databaseUrl:
        'postgresql://oss:oss-dev@127.0.0.1:5432/oss_hub_test?schema=private',
    },
  },
  {
    name: 'schema query가 중복될 때',
    environment: {
      ...isolatedEnvironment,
      databaseUrl:
        'postgresql://oss:oss-dev@127.0.0.1:5432/oss_hub_test?schema=public&schema=public',
    },
  },
] as const satisfies readonly {
  readonly name: string;
  readonly environment: IntegrationDatabaseEnvironment;
}[];

describe('integration database guard', () => {
  it.each(rejectedEnvironments)('$name 접근을 거부한다', ({ environment }) => {
    // Given: runner가 관리하지 않는 DB 실행 환경이다.

    // When / Then: DB client를 만들기 전에 guard가 접근을 거부한다.
    expect(() => assertIsolatedIntegrationDatabase(environment)).toThrow(
      IntegrationDatabaseGuardError,
    );
  });

  it('runner가 만든 loopback 테스트 DB만 허용한다', () => {
    // Given: runner 표식과 격리 DB URL이 모두 유효하다.

    // When / Then: guard를 통과한다.
    expect(() =>
      assertIsolatedIntegrationDatabase(isolatedEnvironment),
    ).not.toThrow();
  });
});
