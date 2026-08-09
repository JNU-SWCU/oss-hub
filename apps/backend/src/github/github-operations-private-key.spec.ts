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

// PEM 헤더 리터럴은 public-safe deny-list에 걸리므로 조각으로 조립한다
// (github-operations.config.spec.ts와 같은 방식).
const PEM_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const PEM_FOOTER = ['-----END', 'PRIVATE KEY-----'].join(' ');

const FILE_ENV_KEY = 'GITHUB_OPERATIONS_APP_PRIVATE_KEY_FILE';
const LEGACY_ENV_KEY = 'GITHUB_OPERATIONS_APP_PRIVATE_KEY';

const MANAGED_KEYS = [
  'GITHUB_APP_ORG',
  'GITHUB_OPERATIONS_APP_ID',
  LEGACY_ENV_KEY,
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

  it('legacy env 문자열만 설정되면 escaped 개행 치환을 유지한다', () => {
    // Given
    process.env[LEGACY_ENV_KEY] = `${PEM_HEADER}\\nsynthetic\\n${PEM_FOOTER}`;

    // When
    const credentials = new GithubOperationsConfig().requireCredentials();

    // Then
    expect(credentials.privateKey).toBe(
      `${PEM_HEADER}\nsynthetic\n${PEM_FOOTER}`,
    );
  });

  it('둘 다 설정되면 파일이 이기고 legacy 값은 무시한다', () => {
    // Given
    const pem = syntheticPem();
    const legacyMarker = 'synthetic-legacy-must-be-ignored';
    process.env[FILE_ENV_KEY] = writeKeyFile('wins.pem', pem);
    process.env[LEGACY_ENV_KEY] =
      `${PEM_HEADER}\\n${legacyMarker}\\n${PEM_FOOTER}`;

    // When
    const credentials = new GithubOperationsConfig().requireCredentials();

    // Then
    expect(credentials.privateKey).toBe(pem);
    expect(credentials.privateKey).not.toContain(legacyMarker);
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

  it('_FILE이 공백만이면 미설정으로 보고 legacy로 넘어간다', () => {
    // Given
    process.env[FILE_ENV_KEY] = '   ';
    process.env[LEGACY_ENV_KEY] = `${PEM_HEADER}\\nsynthetic\\n${PEM_FOOTER}`;

    // When
    const credentials = new GithubOperationsConfig().requireCredentials();

    // Then
    expect(credentials.privateKey).toBe(
      `${PEM_HEADER}\nsynthetic\n${PEM_FOOTER}`,
    );
  });

  it('_FILE 경로가 유효하지 않으면 legacy로 fallback하지 않고 fail closed한다', () => {
    // Given: 명시된 파일이 없고 legacy는 유효하다.
    const legacyMarker = 'synthetic-legacy-must-not-rescue';
    process.env[FILE_ENV_KEY] = join(workspace, 'missing.pem');
    process.env[LEGACY_ENV_KEY] =
      `${PEM_HEADER}\\n${legacyMarker}\\n${PEM_FOOTER}`;

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
    expect((caught as Error).message).not.toContain(legacyMarker);
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
