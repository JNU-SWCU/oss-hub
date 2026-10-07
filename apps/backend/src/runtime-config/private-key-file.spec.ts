import { generateKeyPairSync } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrivateKeyFileError, readPrivateKeyFile } from './private-key-file';

const PKCS8_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const PKCS1_HEADER = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
const PKCS8_FOOTER = ['-----END', 'PRIVATE KEY-----'].join(' ');

const ENV_KEY = 'GITHUB_COLLECTION_APP_PRIVATE_KEY_FILE';

function syntheticPem(type: 'pkcs8' | 'pkcs1'): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type, format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return privateKey;
}

describe('readPrivateKeyFile', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'oss-hub-pem-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  function writeKeyFile(name: string, content: string): string {
    const path = join(workspace, name);
    writeFileSync(path, content, 'utf8');
    return path;
  }

  it('PKCS#8 PEM 파일을 읽어 개행을 보존한 문자열로 돌려준다', () => {
    const pem = syntheticPem('pkcs8');
    const path = writeKeyFile('pkcs8.pem', pem);

    const loaded = readPrivateKeyFile(ENV_KEY, path);

    expect(loaded).toBe(pem.trim());
    expect(loaded).toContain('\n');
    expect(loaded).not.toContain('\\n');
    expect(loaded.startsWith(PKCS8_HEADER)).toBe(true);
  });

  it('PKCS#1 PEM 파일도 허용한다', () => {
    const pem = syntheticPem('pkcs1');
    const path = writeKeyFile('pkcs1.pem', pem);

    const loaded = readPrivateKeyFile(ENV_KEY, path);

    expect(loaded.startsWith(PKCS1_HEADER)).toBe(true);
  });

  it('앞뒤 공백만 정리하고 내부 구조는 바꾸지 않는다', () => {
    const pem = syntheticPem('pkcs8');
    const path = writeKeyFile('padded.pem', `\n  ${pem}\n\n`);

    const loaded = readPrivateKeyFile(ENV_KEY, path);

    expect(loaded).toBe(pem.trim());
  });

  it('파일이 없으면 거절한다', () => {
    const path = join(workspace, 'missing.pem');

    expect(() => readPrivateKeyFile(ENV_KEY, path)).toThrow(
      PrivateKeyFileError,
    );
  });

  it('디렉터리를 지정하면 거절한다', () => {
    const path = join(workspace, 'a-directory');
    mkdirSync(path);

    expect(() => readPrivateKeyFile(ENV_KEY, path)).toThrow(
      PrivateKeyFileError,
    );
  });

  it('빈 파일을 거절한다', () => {
    const path = writeKeyFile('empty.pem', '');

    expect(() => readPrivateKeyFile(ENV_KEY, path)).toThrow(
      PrivateKeyFileError,
    );
  });

  it('공백만 있는 파일을 거절한다', () => {
    const path = writeKeyFile('blank.pem', '   \n\t\n  ');

    expect(() => readPrivateKeyFile(ENV_KEY, path)).toThrow(
      PrivateKeyFileError,
    );
  });

  it('64 KiB를 넘는 파일을 읽지 않고 거절한다', () => {
    const oversized = `${PKCS8_HEADER}\n${'A'.repeat(65_536)}\n${PKCS8_FOOTER}\n`;
    const path = writeKeyFile('oversized.pem', oversized);

    expect(() => readPrivateKeyFile(ENV_KEY, path)).toThrow(
      PrivateKeyFileError,
    );
  });

  it('PEM 헤더가 없으면 거절한다', () => {
    const path = writeKeyFile('headerless.pem', 'bm90LWEtcGVtLWZpbGU=\n');

    expect(() => readPrivateKeyFile(ENV_KEY, path)).toThrow(
      PrivateKeyFileError,
    );
  });

  it('헤더는 맞지만 본문이 손상된 PEM을 거절한다', () => {
    const corrupted = `${PKCS8_HEADER}\nQUJDREVGRw==\n${PKCS8_FOOTER}\n`;
    const path = writeKeyFile('corrupted.pem', corrupted);

    expect(() => readPrivateKeyFile(ENV_KEY, path)).toThrow(
      PrivateKeyFileError,
    );
  });

  it('중간이 잘린 유효 키를 거절한다', () => {
    const pem = syntheticPem('pkcs8');
    const lines = pem.trim().split('\n');
    const truncated = [
      lines[0],
      ...lines.slice(1, Math.floor(lines.length / 2)),
      lines[lines.length - 1],
    ].join('\n');
    const path = writeKeyFile('truncated.pem', truncated);

    expect(() => readPrivateKeyFile(ENV_KEY, path)).toThrow(
      PrivateKeyFileError,
    );
  });

  const itUnlessRoot = process.getuid?.() === 0 ? it.skip : it;

  itUnlessRoot('읽을 수 없는 파일을 거절한다', () => {
    const path = writeKeyFile('unreadable.pem', syntheticPem('pkcs8'));
    chmodSync(path, 0o000);

    expect(() => readPrivateKeyFile(ENV_KEY, path)).toThrow(
      PrivateKeyFileError,
    );

    chmodSync(path, 0o600);
  });

  it('오류에 env 키 이름과 사유 코드만 담고 경로·내용은 노출하지 않는다', () => {
    const secretMarker = 'synthetic-key-body-must-not-leak';
    const path = writeKeyFile(
      'leak-probe-must-not-appear.pem',
      `${PKCS8_HEADER}\n${secretMarker}\n${PKCS8_FOOTER}\n`,
    );

    let caught: unknown;
    try {
      readPrivateKeyFile(ENV_KEY, path);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PrivateKeyFileError);
    const serialized = `${(caught as Error).message} ${(caught as Error).stack ?? ''}`;
    expect((caught as Error).message).toContain(ENV_KEY);
    expect(serialized).not.toContain(secretMarker);
    expect((caught as Error).message).not.toContain(path);
    expect((caught as Error).message).not.toContain('leak-probe');
  });

  it('성공·실패 어느 경로에서도 콘솔로 값이나 경로를 출력하지 않는다', () => {
    const secretMarker = 'synthetic-console-leak-probe';
    const validPath = writeKeyFile('console-valid.pem', syntheticPem('pkcs8'));
    const corruptedPath = writeKeyFile(
      'console-corrupt.pem',
      `${PKCS8_HEADER}\n${secretMarker}\n${PKCS8_FOOTER}\n`,
    );
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (method) => jest.spyOn(console, method).mockImplementation(() => {}),
    );

    try {
      readPrivateKeyFile(ENV_KEY, validPath);
      expect(() => readPrivateKeyFile(ENV_KEY, corruptedPath)).toThrow(
        PrivateKeyFileError,
      );

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });

  it('오류 코드로 실패 사유를 구분할 수 있다', () => {
    const missing = join(workspace, 'nope.pem');
    const empty = writeKeyFile('empty-code.pem', '');

    const codes = [missing, empty].map((path) => {
      try {
        readPrivateKeyFile(ENV_KEY, path);
        return null;
      } catch (error) {
        return (error as PrivateKeyFileError).code;
      }
    });

    expect(codes[0]).toBeTruthy();
    expect(codes[1]).toBeTruthy();
    expect(codes[0]).not.toBe(codes[1]);
  });
});
