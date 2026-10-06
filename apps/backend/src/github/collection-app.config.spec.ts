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
    const pem = syntheticPem();
    const path = writeKeyFile('collection.pem', pem);

    const config = CollectionAppConfig.fromEnv(
      baseEnv({ [FILE_ENV_KEY]: path }),
    );

    expect(config.privateKey).toBe(pem);
    expect(config.privateKey).toContain('\n');
    expect(config.privateKey).not.toContain('\\n');
  });

  it('둘 다 없으면 기존과 같은 설정 오류로 실패한다', () => {
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
    const env = baseEnv({
      [FILE_ENV_KEY]: join(workspace, 'missing.pem'),
    });

    let caught: unknown;
    try {
      CollectionAppConfig.fromEnv(env);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CollectionAppConfigError);
    expect((caught as CollectionAppConfigError).field).toBe(FILE_ENV_KEY);
    expect((caught as Error).cause).toBeInstanceOf(PrivateKeyFileError);
  });

  it('_FILE이 손상된 PEM을 가리키면 파싱 실패로 fail closed한다', () => {
    const path = writeKeyFile(
      'corrupted.pem',
      `${PEM_HEADER}\nQUJDREVGRw==\n${PEM_FOOTER}\n`,
    );

    let caught: unknown;
    try {
      CollectionAppConfig.fromEnv(baseEnv({ [FILE_ENV_KEY]: path }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CollectionAppConfigError);
    expect((caught as CollectionAppConfigError).field).toBe(FILE_ENV_KEY);
    expect((caught as Error).cause).toBeInstanceOf(PrivateKeyFileError);
    expect(((caught as Error).cause as PrivateKeyFileError).code).toBe(
      PRIVATE_KEY_FILE_ERROR_CODES.INVALID_KEY,
    );
  });
});
