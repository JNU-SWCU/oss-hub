import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { DomainException } from '../../../common/error-code';
import type { RuntimeConfig } from '../../../runtime-config/runtime-config';
import {
  PUBLIC_PROJECTS_ERROR_CODES,
  PublicProjectsErrorCode,
} from './public-projects-error-code.enum';
import type { PublicProjectCursor } from './public-projects.repository';

const CURSOR_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PAYLOAD_PAD_BLOCK = 64;
const KEY_BYTES = 32;

const CURSOR_KEY_SALT = 'oss-hub/public-projects/cursor/v1';
const CURSOR_KEY_INFO = 'public-project-cursor-aes-256-gcm';
const MIN_SESSION_SECRET_BYTES = 32;

export class PublicProjectCursorSecretError extends Error {
  readonly envName = 'SESSION_SECRET';

  constructor(reason: string) {
    super(`공개 프로젝트 커서 키를 만들 수 없습니다: ${reason}`);
    this.name = PublicProjectCursorSecretError.name;
  }
}

export type PublicProjectCursorKey = Buffer;

const derivedKeyCache = new Map<string, PublicProjectCursorKey>();

export function resolvePublicProjectCursorKey(
  config: Pick<RuntimeConfig, 'SESSION_SECRET'>,
): PublicProjectCursorKey {
  const raw = config.SESSION_SECRET;
  if (raw === undefined || raw.trim() === '') {
    throw new PublicProjectCursorSecretError('SESSION_SECRET이 비어 있습니다.');
  }
  const cached = derivedKeyCache.get(raw);
  if (cached !== undefined) return cached;

  const secret = Buffer.from(raw, 'base64url');
  if (secret.length < MIN_SESSION_SECRET_BYTES) {
    throw new PublicProjectCursorSecretError(
      `SESSION_SECRET은 base64url로 ${MIN_SESSION_SECRET_BYTES}바이트 이상이어야 합니다.`,
    );
  }
  const key = Buffer.from(
    hkdfSync('sha256', secret, CURSOR_KEY_SALT, CURSOR_KEY_INFO, KEY_BYTES),
  );
  derivedKeyCache.set(raw, key);
  return key;
}

function versionAad(): Buffer {
  return Buffer.from([CURSOR_VERSION]);
}

export function encodePublicProjectCursor(
  cursor: PublicProjectCursor,
  key: PublicProjectCursorKey,
): string {
  const json = JSON.stringify({
    p: cursor.publishedAt.toISOString(),
    i: cursor.id,
  });
  const paddedLength =
    Math.ceil(json.length / PAYLOAD_PAD_BLOCK) * PAYLOAD_PAD_BLOCK;
  const payload = Buffer.from(json.padEnd(paddedLength, ' '), 'utf8');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(versionAad());
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([
    versionAad(),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]).toString('base64url');
}

export function decodePublicProjectCursor(
  pageId: string,
  key: PublicProjectCursorKey,
): PublicProjectCursor {
  try {
    const token = Buffer.from(pageId, 'base64url');
    if (token.length <= 1 + IV_BYTES + TAG_BYTES) {
      throw new Error('malformed cursor length');
    }
    if (token[0] !== CURSOR_VERSION) {
      throw new Error('unsupported cursor version');
    }
    const iv = token.subarray(1, 1 + IV_BYTES);
    const tag = token.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const ciphertext = token.subarray(1 + IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(versionAad());
    decipher.setAuthTag(tag);
    const payload = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');

    const decoded = JSON.parse(payload) as { p: unknown; i: unknown };
    if (typeof decoded.p !== 'string' || typeof decoded.i !== 'string') {
      throw new Error('malformed cursor shape');
    }
    const publishedAt = new Date(decoded.p);
    if (Number.isNaN(publishedAt.getTime())) {
      throw new Error('malformed cursor date');
    }
    return { publishedAt, id: decoded.i };
  } catch (error) {
    if (error instanceof PublicProjectCursorSecretError) throw error;
    throw new DomainException(
      PUBLIC_PROJECTS_ERROR_CODES[PublicProjectsErrorCode.INVALID_PAGE_ID],
    );
  }
}
