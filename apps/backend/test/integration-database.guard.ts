export const INTEGRATION_RUNNER_SENTINEL =
  'oss-hub-isolated-integration-v1' as const;

export type IntegrationDatabaseEnvironment = {
  readonly databaseUrl: string | undefined;
  readonly runnerSentinel: string | undefined;
};

export class IntegrationDatabaseGuardError extends Error {
  constructor() {
    super('Integration database must be created by the isolated runner');
    this.name = 'IntegrationDatabaseGuardError';
  }
}

export function assertIsolatedIntegrationDatabase(
  environment: IntegrationDatabaseEnvironment,
): void {
  if (
    environment.runnerSentinel !== INTEGRATION_RUNNER_SENTINEL ||
    environment.databaseUrl === undefined
  ) {
    throw new IntegrationDatabaseGuardError();
  }

  if (!URL.canParse(environment.databaseUrl)) {
    throw new IntegrationDatabaseGuardError();
  }
  const databaseUrl = new URL(environment.databaseUrl);

  if (
    databaseUrl.protocol !== 'postgresql:' ||
    databaseUrl.hostname !== '127.0.0.1' ||
    databaseUrl.port === '' ||
    databaseUrl.pathname !== '/oss_hub_test'
  ) {
    throw new IntegrationDatabaseGuardError();
  }
}
