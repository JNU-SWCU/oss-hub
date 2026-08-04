import { DomainException } from '../common/error-code';
import {
  PUBLIC_PROJECTS_ERROR_CODES,
  PublicProjectsErrorCode,
} from './public-projects-error-code.enum';
import type { PublicProjectCursor } from './public-projects.store';

/**
 * todo 16 — "index 기반 page ID". opaque 토큰이지만 내용은 `Repository_visibility_
 * publishedAt_id_idx`가 실제로 정렬하는 키(publishedAt, id) 그대로다 — 서버가 매 페이지마다
 * 임의 상태를 새로 만들지 않고, 그 인덱스 위치를 그대로 다음 요청의 커서로 왕복시킨다.
 */
export function encodePublicProjectCursor(cursor: PublicProjectCursor): string {
  return Buffer.from(
    JSON.stringify({ p: cursor.publishedAt.toISOString(), i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodePublicProjectCursor(pageId: string): PublicProjectCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(pageId, 'base64url').toString('utf8'),
    ) as { p: unknown; i: unknown };
    if (typeof decoded.p !== 'string' || typeof decoded.i !== 'string') {
      throw new Error('malformed cursor shape');
    }
    const publishedAt = new Date(decoded.p);
    if (Number.isNaN(publishedAt.getTime())) {
      throw new Error('malformed cursor date');
    }
    return { publishedAt, id: decoded.i };
  } catch {
    throw new DomainException(
      PUBLIC_PROJECTS_ERROR_CODES[PublicProjectsErrorCode.INVALID_PAGE_ID],
    );
  }
}
