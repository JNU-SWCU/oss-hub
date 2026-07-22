import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import { GithubOperationsConfig } from './github-operations.config';

describe('GithubOperationsConfig', () => {
  const pemHeader = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const pemFooter = ['-----END', 'PRIVATE KEY-----'].join(' ');
  const originalOrganization = process.env.GITHUB_APP_ORG;
  const originalAppId = process.env.GITHUB_OPERATIONS_APP_ID;
  const originalPrivateKey = process.env.GITHUB_OPERATIONS_APP_PRIVATE_KEY;

  afterEach(() => {
    restoreEnvironment('GITHUB_APP_ORG', originalOrganization);
    restoreEnvironment('GITHUB_OPERATIONS_APP_ID', originalAppId);
    restoreEnvironment('GITHUB_OPERATIONS_APP_PRIVATE_KEY', originalPrivateKey);
  });

  it('Operations App 자격증명을 필요 시점에 불러온다', () => {
    // Given: 저장소 운영 전용 App 설정이 모두 있다.
    process.env.GITHUB_APP_ORG = 'synthetic-org';
    process.env.GITHUB_OPERATIONS_APP_ID = '12345';
    process.env.GITHUB_OPERATIONS_APP_PRIVATE_KEY =
      `${pemHeader}\\nsynthetic\\n${pemFooter}`;

    // When: 자격증명을 요구한다.
    const credentials = new GithubOperationsConfig().requireCredentials();

    // Then: secret store의 escaped newline만 실제 PEM 줄바꿈으로 복원한다.
    expect(credentials).toEqual({
      organization: 'synthetic-org',
      appId: '12345',
      privateKey: `${pemHeader}\nsynthetic\n${pemFooter}`,
    });
  });

  it('설정이 하나라도 없으면 값 노출 없이 fail-closed한다', () => {
    // Given: private key만 누락되고 나머지 설정은 있다.
    const syntheticAppId = 'synthetic-app-id-must-not-leak';
    process.env.GITHUB_APP_ORG = 'synthetic-org';
    process.env.GITHUB_OPERATIONS_APP_ID = syntheticAppId;
    delete process.env.GITHUB_OPERATIONS_APP_PRIVATE_KEY;

    // When: 자격증명을 요구한다.
    const requireCredentials = (): unknown =>
      new GithubOperationsConfig().requireCredentials();

    // Then: 정규화된 구성 오류만 반환하고 입력값은 메시지에 담지 않는다.
    expect(requireCredentials).toThrow(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
      ),
    );
    expect(requireCredentials).not.toThrow(syntheticAppId);
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
