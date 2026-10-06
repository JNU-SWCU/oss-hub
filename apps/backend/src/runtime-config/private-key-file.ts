import { createPrivateKey } from 'node:crypto';
import { readFileSync, statSync, type Stats } from 'node:fs';

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

export function readPrivateKeyFile(envKey: string, filePath: string): string {
  const stats = statFile(envKey, filePath);

  if (!stats.isFile()) {
    throw new PrivateKeyFileError(
      envKey,
      PRIVATE_KEY_FILE_ERROR_CODES.NOT_A_REGULAR_FILE,
    );
  }

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

function assertParsableKey(envKey: string, content: string): void {
  try {
    createPrivateKey(content);
  } catch {
    throw new PrivateKeyFileError(
      envKey,
      PRIVATE_KEY_FILE_ERROR_CODES.INVALID_KEY,
    );
  }
}
