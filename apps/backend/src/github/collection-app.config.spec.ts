import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CollectionAppConfig,
  CollectionAppConfigError,
} from './collection-app.config';
import {
  PRIVATE_KEY_FILE_ERROR_CODES,
  PrivateKeyFileError,
} from '../runtime-config/private-key-file';

// PEM 헤더 리터럴은 public-safe deny-list에 걸리므로 조각으로 조립한다
// (github-operations.config.spec.ts와 같은 방식).
const PEM_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const PEM_FOOTER = ['-----END', 'PRIVATE KEY-----'].join(' ');

const FILE_ENV_KEY = 'GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE';

function syntheticPem(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return privateKey.trim();
}

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_COLLECTION_APP_ID: '12345',
    GITHUB_APP_ORG: 'synthetic-org',
    ...overrides,
  };
}

describe('CollectionAppConfig private key input', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'oss-hub-collection-pem-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  function writeKeyFile(name: string, content: string): string {
    const path = join(workspace, name);
    writeFileSync(path, content, 'utf8');
    return path;
  }

  it('_FILE만 설정되면 파일 내용을 privateKey로 쓴다', () => {
    // Given: 파일 경로만 주어진다.
    const pem = syntheticPem();
    const path = writeKeyFile('collection.pem', pem);

    // When
    const config = CollectionAppConfig.fromEnv(
      baseEnv({ [FILE_ENV_KEY]: path }),
    );

    // Then: 실제 줄바꿈이 보존된 PEM이 그대로 들어온다.
    expect(config.privateKey).toBe(pem);
    expect(config.privateKey).toContain('\n');
    expect(config.privateKey).not.toContain('\\n');
  });

  it('둘 다 없으면 기존과 같은 설정 오류로 실패한다', () => {
    // Given / When / Then
    expect(() => CollectionAppConfig.fromEnv(baseEnv())).toThrow(
      CollectionAppConfigError,
    );
  });

  it('_FILE이 공백만이면 구성 오류로 fail-closed한다', () => {
    expect(() =>
      CollectionAppConfig.fromEnv(baseEnv({ [FILE_ENV_KEY]: '   ' })),
    ).toThrow(CollectionAppConfigError);
  });

  it('_FILE 경로가 유효하지 않으면 fail closed한다', () => {
    // Given
    const env = baseEnv({
      [FILE_ENV_KEY]: join(workspace, 'missing.pem'),
    });

    // When
    let caught: unknown;
    try {
      CollectionAppConfig.fromEnv(env);
    } catch (error) {
      caught = error;
    }

    // Then: 모듈 오류 계약을 지키면서 실패 사유는 cause로 보존한다.
    expect(caught).toBeInstanceOf(CollectionAppConfigError);
    expect((caught as CollectionAppConfigError).field).toBe(FILE_ENV_KEY);
    expect((caught as Error).cause).toBeInstanceOf(PrivateKeyFileError);
  });

  it('_FILE이 손상된 PEM을 가리키면 파싱 실패로 fail closed한다', () => {
    // Given: 헤더는 맞지만 본문이 깨진 파일
    const path = writeKeyFile(
      'corrupted.pem',
      `${PEM_HEADER}\nQUJDREVGRw==\n${PEM_FOOTER}\n`,
    );

    // When
    let caught: unknown;
    try {
      CollectionAppConfig.fromEnv(baseEnv({ [FILE_ENV_KEY]: path }));
    } catch (error) {
      caught = error;
    }

    // Then: 실패 주체가 파일 입력임을 확인한다 — legacy 부재로 인한 오류와 구별해야 한다.
    expect(caught).toBeInstanceOf(CollectionAppConfigError);
    expect((caught as CollectionAppConfigError).field).toBe(FILE_ENV_KEY);
    expect((caught as Error).cause).toBeInstanceOf(PrivateKeyFileError);
    expect(((caught as Error).cause as PrivateKeyFileError).code).toBe(
      PRIVATE_KEY_FILE_ERROR_CODES.INVALID_KEY,
    );
  });
});
