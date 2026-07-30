import { createPrivateKey } from 'node:crypto';
import { readFileSync, statSync, type Stats } from 'node:fs';

/**
 * GitHub App 개인키를 파일에서 읽는다.
 *
 * env 문자열 경로와 달리 파일 경로는 "설정된 것 자체가 의도"이므로, 읽기·파싱 실패를
 * legacy 경로로 조용히 fallback하지 않고 즉시 실패로 만든다(fail closed).
 * 오류에는 env 키 이름과 사유 코드만 담는다 — 경로와 키 내용은 로그·스택 어디에도 넣지 않는다.
 */

const MAX_PRIVATE_KEY_FILE_BYTES = 65_536;
const PEM_HEADER_PREFIX = '-----BEGIN';

export const PRIVATE_KEY_FILE_ERROR_CODES = {
  NOT_FOUND: 'PRIVATE_KEY_FILE_NOT_FOUND',
  NOT_A_REGULAR_FILE: 'PRIVATE_KEY_FILE_NOT_A_REGULAR_FILE',
  TOO_LARGE: 'PRIVATE_KEY_FILE_TOO_LARGE',
  UNREADABLE: 'PRIVATE_KEY_FILE_UNREADABLE',
  EMPTY: 'PRIVATE_KEY_FILE_EMPTY',
  NOT_PEM: 'PRIVATE_KEY_FILE_NOT_PEM',
  INVALID_KEY: 'PRIVATE_KEY_FILE_INVALID_KEY',
} as const;

export type PrivateKeyFileErrorCode =
  (typeof PRIVATE_KEY_FILE_ERROR_CODES)[keyof typeof PRIVATE_KEY_FILE_ERROR_CODES];

export class PrivateKeyFileError extends Error {
  readonly code: PrivateKeyFileErrorCode;
  readonly envKey: string;

  constructor(envKey: string, code: PrivateKeyFileErrorCode) {
    super(`${envKey}: ${code}`);
    this.name = 'PrivateKeyFileError';
    this.code = code;
    this.envKey = envKey;
  }
}

/**
 * 파일 경로가 설정돼 있으면 읽기·파싱 실패 시에도 legacy 문자열로 되돌아가지 않는다 —
 * 조용한 fallback은 잘못된 키로 운영이 도는 것을 숨긴다. 둘 다 없으면 null을 돌려
 * 호출자의 기존 설정 오류에 맡긴다.
 */
export function resolvePrivateKeyInput(
  fileEnvKey: string,
  rawFilePath: string | undefined,
  rawLegacyValue: string | undefined,
  onLegacyIgnored?: () => void,
): string | null {
  const filePath = rawFilePath?.trim();
  if (filePath) {
    if (rawLegacyValue?.trim()) {
      onLegacyIgnored?.();
    }
    return readPrivateKeyFile(fileEnvKey, filePath);
  }

  const legacy = rawLegacyValue?.trim();
  if (legacy) {
    return legacy.replace(/\\n/g, '\n');
  }

  return null;
}

export function readPrivateKeyFile(envKey: string, filePath: string): string {
  const stats = statFile(envKey, filePath);

  if (!stats.isFile()) {
    throw new PrivateKeyFileError(
      envKey,
      PRIVATE_KEY_FILE_ERROR_CODES.NOT_A_REGULAR_FILE,
    );
  }

  // 크기를 먼저 본다 — 상한을 넘는 파일은 메모리로 읽지 않는다.
  if (stats.size > MAX_PRIVATE_KEY_FILE_BYTES) {
    throw new PrivateKeyFileError(
      envKey,
      PRIVATE_KEY_FILE_ERROR_CODES.TOO_LARGE,
    );
  }

  const content = readFile(envKey, filePath).trim();

  if (content.length === 0) {
    throw new PrivateKeyFileError(envKey, PRIVATE_KEY_FILE_ERROR_CODES.EMPTY);
  }

  if (!content.startsWith(PEM_HEADER_PREFIX)) {
    throw new PrivateKeyFileError(envKey, PRIVATE_KEY_FILE_ERROR_CODES.NOT_PEM);
  }

  assertParsableKey(envKey, content);

  return content;
}

function statFile(envKey: string, filePath: string): Stats {
  try {
    return statSync(filePath);
  } catch {
    throw new PrivateKeyFileError(
      envKey,
      PRIVATE_KEY_FILE_ERROR_CODES.NOT_FOUND,
    );
  }
}

function readFile(envKey: string, filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    throw new PrivateKeyFileError(
      envKey,
      PRIVATE_KEY_FILE_ERROR_CODES.UNREADABLE,
    );
  }
}

/**
 * 헤더 문자열만 맞고 본문이 깨진 PEM은 토큰 요청 시점까지 발견되지 않는다.
 * 여기서 실제로 파싱해 기동·설정 단계에서 걸러낸다. PKCS#1과 PKCS#8을 모두 받는다.
 */
function assertParsableKey(envKey: string, content: string): void {
  try {
    createPrivateKey(content);
  } catch {
    // 원본 오류는 버린다 — OpenSSL 메시지에 입력 일부가 섞여 나올 수 있다.
    throw new PrivateKeyFileError(
      envKey,
      PRIVATE_KEY_FILE_ERROR_CODES.INVALID_KEY,
    );
  }
}
