import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './domain/github-app.error';
import { GithubOperationsConfig } from './github-operations.config';

describe('GithubOperationsConfig', () => {
  const originalOrganization = process.env.GITHUB_APP_ORG;
  const originalAppId = process.env.GITHUB_OPERATIONS_APP_ID;
  const originalPrivateKeyFile =
    process.env.GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE;
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'operations-config-'));
  });

  afterEach(() => {
    restoreEnvironment('GITHUB_APP_ORG', originalOrganization);
    restoreEnvironment('GITHUB_OPERATIONS_APP_ID', originalAppId);
    restoreEnvironment(
      'GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE',
      originalPrivateKeyFile,
    );
    rmSync(workspace, { recursive: true, force: true });
  });

  it('Operations App 자격증명을 필요 시점에 불러온다', () => {
    process.env.GITHUB_APP_ORG = 'synthetic-org';
    process.env.GITHUB_OPERATIONS_APP_ID = '12345';
    const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString()
      .trim();
    const privateKeyFile = join(workspace, 'operations.pem');
    writeFileSync(privateKeyFile, privateKey);
    process.env.GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE = privateKeyFile;

    const credentials = new GithubOperationsConfig().requireCredentials();

    expect(credentials).toEqual({
      organization: 'synthetic-org',
      appId: '12345',
      privateKey,
    });
  });

  it('설정이 하나라도 없으면 값 노출 없이 fail-closed한다', () => {
    const syntheticAppId = 'synthetic-app-id-must-not-leak';
    process.env.GITHUB_APP_ORG = 'synthetic-org';
    process.env.GITHUB_OPERATIONS_APP_ID = syntheticAppId;
    delete process.env.GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE;

    const requireCredentials = (): unknown =>
      new GithubOperationsConfig().requireCredentials();

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
