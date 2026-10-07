import {
  loadRuntimeConfig,
  RUNTIME_CONFIG_KEYS,
  type RuntimeConfig,
  type RuntimeEnvKey,
} from './runtime-config';

function syntheticEnv(
  overrides: Partial<Record<RuntimeEnvKey, string | undefined>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of RUNTIME_CONFIG_KEYS) {
    env[key] = `synthetic-${key.toLowerCase()}`;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

describe('loadRuntimeConfig', () => {
  it('copies every manifest key as a raw string without trim or default', () => {
    const env = syntheticEnv({
      SESSION_SECRET: '  padded-secret  ',
      FRONTEND_URL: '',
      PORT: undefined,
    });

    const config = loadRuntimeConfig(env);

    expect(config.SESSION_SECRET).toBe('  padded-secret  ');
    expect(config.FRONTEND_URL).toBe('');
    expect(config.PORT).toBeUndefined();
    expect(config.MAIL_MODE).toBe('synthetic-mail_mode');
    expect(config.GITHUB_COLLECTION_APP_SMOKE_PUBLIC_ALIASES).toBe(
      'synthetic-github_collection_app_smoke_public_aliases',
    );
    expect(config.GITHUB_COLLECTION_APP_SMOKE_PRIVATE_ALIAS).toBe(
      'synthetic-github_collection_app_smoke_private_alias',
    );
    expect(config.SUBMISSION_FILE_CLEANUP_OPERATOR_ID).toBe(
      'synthetic-submission_file_cleanup_operator_id',
    );
    expect(config.SUBMISSION_FILE_STORAGE_MODE).toBe(
      'synthetic-submission_file_storage_mode',
    );
    expect(config.SUBMISSION_FILE_CLEANUP_MAINTENANCE_ENABLED).toBe(
      'synthetic-submission_file_cleanup_maintenance_enabled',
    );
  });

  it('snapshots values so later source env mutation does not affect the config', () => {
    const env = syntheticEnv({
      GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-original-secret',
    });

    const config = loadRuntimeConfig(env);
    env.GITHUB_OAUTH_CLIENT_SECRET = 'synthetic-mutated-secret';
    env.MAIL_MODE = 'synthetic-mutated-mail-mode';

    expect(config.GITHUB_OAUTH_CLIENT_SECRET).toBe('synthetic-original-secret');
    expect(config.MAIL_MODE).toBe('synthetic-mail_mode');
  });

  it('returns a frozen object', () => {
    const config = loadRuntimeConfig(syntheticEnv());

    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as { MAIL_MODE: string }).MAIL_MODE = 'mutated';
    }).toThrow(TypeError);
    expect(config.MAIL_MODE).toBe('synthetic-mail_mode');
  });

  it('matches the literal key manifest exactly', () => {
    const config = loadRuntimeConfig(syntheticEnv());
    const loadedKeys = Object.keys(config) as RuntimeEnvKey[];

    expect(loadedKeys).toEqual([...RUNTIME_CONFIG_KEYS]);
    expect(RUNTIME_CONFIG_KEYS).toHaveLength(35);
    expect(RUNTIME_CONFIG_KEYS).toContain('MAIL_MODE');

    const expected: RuntimeConfig = Object.freeze(
      Object.fromEntries(
        RUNTIME_CONFIG_KEYS.map((key) => [
          key,
          `synthetic-${key.toLowerCase()}`,
        ]),
      ),
    ) as RuntimeConfig;
    expect(config).toEqual(expected);
  });

  it('treats missing keys as undefined without inventing defaults', () => {
    const env: NodeJS.ProcessEnv = {};

    const config = loadRuntimeConfig(env);

    for (const key of RUNTIME_CONFIG_KEYS) {
      expect(config[key]).toBeUndefined();
    }
  });
});
