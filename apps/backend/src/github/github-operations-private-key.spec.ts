import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './domain/github-app.error';
import { GithubOperationsConfig } from './github-operations.config';
import {
  PRIVATE_KEY_FILE_ERROR_CODES,
  PrivateKeyFileError,
} from '../runtime-config/private-key-file';

const PEM_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const PEM_FOOTER = ['-----END', 'PRIVATE KEY-----'].join(' ');

const FILE_ENV_KEY = 'GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE';

const MANAGED_KEYS = [
  'GITHUB_APP_ORG',
  'GITHUB_OPERATIONS_APP_ID',
  FILE_ENV_KEY,
] as const;

function syntheticPem(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return privateKey.trim();
}

describe('GithubOperationsConfig private key input', () => {
  const originals = new Map<string, string | undefined>();
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'oss-hub-operations-pem-'));
    for (const key of MANAGED_KEYS) {
      originals.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.GITHUB_APP_ORG = 'synthetic-org';
    process.env.GITHUB_OPERATIONS_APP_ID = '12345';
  });

  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      const value = originals.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(workspace, { recursive: true, force: true });
  });

  function writeKeyFile(name: string, content: string): string {
    const path = join(workspace, name);
    writeFileSync(path, content, 'utf8');
    return path;
  }

  it('_FILE만 설정되면 파일 내용을 privateKey로 쓴다', () => {
    const pem = syntheticPem();
    process.env[FILE_ENV_KEY] = writeKeyFile('operations.pem', pem);

    const credentials = new GithubOperationsConfig().requireCredentials();

    expect(credentials.privateKey).toBe(pem);
    expect(credentials.privateKey).not.toContain('\\n');
  });

  it('둘 다 없으면 기존과 같은 구성 오류로 fail-closed한다', () => {
    const requireCredentials = (): unknown =>
      new GithubOperationsConfig().requireCredentials();

    expect(requireCredentials).toThrow(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
      ),
    );
  });

  it('_FILE이 공백만이면 구성 오류로 fail-closed한다', () => {
    process.env[FILE_ENV_KEY] = '   ';

    expect(() => new GithubOperationsConfig().requireCredentials()).toThrow(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
      ),
    );
  });

  it('_FILE 경로가 유효하지 않으면 fail closed한다', () => {
    process.env[FILE_ENV_KEY] = join(workspace, 'missing.pem');

    let caught: unknown;
    try {
      new GithubOperationsConfig().requireCredentials();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GithubOperationsError);
    expect((caught as GithubOperationsError).message).toBe(
      GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
    );
    expect((caught as Error).cause).toBeInstanceOf(PrivateKeyFileError);
  });

  it('_FILE이 손상된 PEM을 가리키면 파싱 실패로 fail closed한다', () => {
    process.env[FILE_ENV_KEY] = writeKeyFile(
      'corrupted.pem',
      `${PEM_HEADER}\nQUJDREVGRw==\n${PEM_FOOTER}\n`,
    );

    let caught: unknown;
    try {
      new GithubOperationsConfig().requireCredentials();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GithubOperationsError);
    expect((caught as Error).cause).toBeInstanceOf(PrivateKeyFileError);
    expect(((caught as Error).cause as PrivateKeyFileError).code).toBe(
      PRIVATE_KEY_FILE_ERROR_CODES.INVALID_KEY,
    );
  });
});
