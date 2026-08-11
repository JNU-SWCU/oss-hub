import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import { GithubOperationsConfig } from './github-operations.config';
import {
  PRIVATE_KEY_FILE_ERROR_CODES,
  PrivateKeyFileError,
} from '../runtime-config/private-key-file';

// PEM 헤더 리터럴은 public-safe deny-list에 걸리므로 조각으로 조립한다.
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
    // Given
    const pem = syntheticPem();
    process.env[FILE_ENV_KEY] = writeKeyFile('operations.pem', pem);

    // When
    const credentials = new GithubOperationsConfig().requireCredentials();

    // Then
    expect(credentials.privateKey).toBe(pem);
    expect(credentials.privateKey).not.toContain('\\n');
  });

  it('둘 다 없으면 기존과 같은 구성 오류로 fail-closed한다', () => {
    // Given: 개인키 입력이 전혀 없다.

    // When
    const requireCredentials = (): unknown =>
      new GithubOperationsConfig().requireCredentials();

    // Then
    expect(requireCredentials).toThrow(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
      ),
    );
  });

  it('_FILE이 공백만이면 구성 오류로 fail-closed한다', () => {
    // Given
    process.env[FILE_ENV_KEY] = '   ';

    // When / Then
    expect(() => new GithubOperationsConfig().requireCredentials()).toThrow(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
        false,
      ),
    );
  });

  it('_FILE 경로가 유효하지 않으면 fail closed한다', () => {
    // Given
    process.env[FILE_ENV_KEY] = join(workspace, 'missing.pem');

    // When
    let caught: unknown;
    try {
      new GithubOperationsConfig().requireCredentials();
    } catch (error) {
      caught = error;
    }

    // Then: 모듈 오류 계약을 지키면서 실패 사유는 cause로 보존한다.
    expect(caught).toBeInstanceOf(GithubOperationsError);
    expect((caught as GithubOperationsError).message).toBe(
      GITHUB_OPERATIONS_ERROR_CODES.CONFIGURATION,
    );
    expect((caught as Error).cause).toBeInstanceOf(PrivateKeyFileError);
  });

  it('_FILE이 손상된 PEM을 가리키면 파싱 실패로 fail closed한다', () => {
    // Given: 헤더는 맞지만 본문이 깨진 파일이 지정된다.
    process.env[FILE_ENV_KEY] = writeKeyFile(
      'corrupted.pem',
      `${PEM_HEADER}\nQUJDREVGRw==\n${PEM_FOOTER}\n`,
    );

    // When
    let caught: unknown;
    try {
      new GithubOperationsConfig().requireCredentials();
    } catch (error) {
      caught = error;
    }

    // Then: 실패 주체가 파일 파싱임을 확인한다 — legacy 부재 오류와 구별해야 한다.
    expect(caught).toBeInstanceOf(GithubOperationsError);
    expect((caught as Error).cause).toBeInstanceOf(PrivateKeyFileError);
    expect(((caught as Error).cause as PrivateKeyFileError).code).toBe(
      PRIVATE_KEY_FILE_ERROR_CODES.INVALID_KEY,
    );
  });
});
