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

/**
 * todo 16 — "index 기반 page ID". 내용은 `Repository_visibility_publishedAt_id_idx`가 실제로
 * 정렬하는 키(publishedAt, id) 그대로다 — 서버가 매 페이지마다 임의 상태를 새로 만들지 않고,
 * 그 인덱스 위치를 그대로 다음 요청의 커서로 왕복시킨다.
 *
 * QA40 — 그 키는 **내부 `Repository.id`와 공개 시각**이고, 페이지 경계는 eligibility fence
 * *이전*의 raw 행으로 정한다(경계가 밀리지 않게 하려는 의도된 설계). 그래서 커서가 평문이면
 * fence에 가려진 저장소의 내부 id·공개 시각이 그대로 새어 나간다. 여기서는 페이지 경계 규칙을
 * 하나도 바꾸지 않고, 대신 페이로드를 서버만 열 수 있게 만들어 그 통로를 막는다.
 *
 * 토큰 형식(불투명 — API 계약으로 노출하지 않는다):
 *   base64url( VERSION(1) || IV(12) || GCM_TAG(16) || AES-256-GCM(padded JSON) )
 * VERSION 바이트는 AAD로 인증하므로 버전만 바꿔치기해도 복호에 실패한다. 평문은 64바이트
 * 배수로 공백 패딩해 토큰 길이가 내부 id 길이를 그대로 드러내지 않게 한다(JSON.parse는 뒤쪽
 * 공백을 무시한다).
 */
const CURSOR_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PAYLOAD_PAD_BLOCK = 64;
const KEY_BYTES = 32;

/**
 * 커서 키는 `SESSION_SECRET`에서 HKDF로 파생한다 — 새 환경변수를 요구하지 않는다.
 * `SESSION_SECRET`은 `AuthConfig`가 부팅 시점에 이미 필수로 강제하므로(없으면 앱이 뜨지
 * 않는다) 앱이 살아 있는 어떤 환경에서도 이 키는 존재한다. `info` 라벨로 도메인을 분리해
 * 세션 서명 키와 커서 키가 서로에게서 유도되지 않게 한다.
 */
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

/**
 * fail-closed — `SESSION_SECRET`이 없거나 너무 짧으면 커서를 만들지도 읽지도 않는다.
 * 평문 커서로 되돌아가는 폴백은 두지 않는다(그 폴백이 곧 이 취약점이다).
 */
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
    // 키 자체가 없는 것은 클라이언트 잘못이 아니다 — 400으로 삼키지 않고 그대로 올린다.
    if (error instanceof PublicProjectCursorSecretError) throw error;
    throw new DomainException(
      PUBLIC_PROJECTS_ERROR_CODES[PublicProjectsErrorCode.INVALID_PAGE_ID],
    );
  }
}
