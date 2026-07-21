import { CollectionConfig } from './collection.config';

describe('CollectionConfig', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    delete process.env.GITHUB_COLLECTOR_TOKEN;
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.GITHUB_BATCH_LOGINS;
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('GITHUB_COLLECTOR_TOKEN이 존재하면 값을 노출하지 않고 초기화를 거부한다', () => {
    const syntheticToken = 'synthetic-collector-token-must-not-leak';
    process.env.GITHUB_COLLECTOR_TOKEN = syntheticToken;
    process.env.GITHUB_OAUTH_CLIENT_ID = 'synthetic-client-id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'synthetic-client-secret';

    const initialize = (): CollectionConfig => new CollectionConfig();

    expect(initialize).toThrow('unsupported configuration');
    expect(initialize).not.toThrow(syntheticToken);
  });

  it('GITHUB_BATCH_LOGINS를 공백 제거한 allowlist로 파싱한다', () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'synthetic-client-id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'synthetic-client-secret';
    process.env.GITHUB_BATCH_LOGINS =
      ' synthetic-login-1,synthetic-login-2, synthetic-login-1, ';

    const config = new CollectionConfig();

    expect(config.batchLogins).toEqual([
      'synthetic-login-1',
      'synthetic-login-2',
    ]);
  });

  it('production에서 non-empty batch 설정은 login 값을 노출하지 않고 초기화를 거부한다', () => {
    const syntheticLogin = 'synthetic-login-must-not-leak';
    process.env.NODE_ENV = 'production';
    process.env.GITHUB_BATCH_LOGINS = syntheticLogin;

    const initialize = (): CollectionConfig => new CollectionConfig();

    expect(initialize).toThrow('production');
    expect(initialize).not.toThrow(syntheticLogin);
  });

  it('production에서 empty batch 설정은 OAuth 자격증명 없이 초기화된다', () => {
    process.env.NODE_ENV = 'production';
    process.env.GITHUB_BATCH_LOGINS = ' , ';

    const config = new CollectionConfig();

    expect(config.batchLogins).toEqual([]);
  });

  it('비운영 환경에서 OAuth 자격증명이 없어도 부팅은 되고, 사용 시점에만 실패한다', () => {
    const config = new CollectionConfig();

    expect(() => config.requireCredentials()).toThrow(
      'GITHUB_OAUTH_CLIENT_ID/SECRET',
    );
  });

  it('자격증명이 있으면 requireCredentials가 그대로 반환한다', () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'synthetic-client-id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'synthetic-client-secret';

    const config = new CollectionConfig();

    expect(config.requireCredentials()).toEqual({
      clientId: 'synthetic-client-id',
      clientSecret: 'synthetic-client-secret',
    });
  });
});
