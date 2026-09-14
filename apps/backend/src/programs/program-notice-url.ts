import { DomainException } from '../common/error-code';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code';

const ORIGIN = 'https://sojoong.kr';
const NOTICE_PREFIX = /^https:\/\/sojoong\.kr(?::443)?\/notice\/notice-board\//;
const NOTICE_QUERY =
  /^\?(?:uid=[1-9]\d{0,11}&mod=document|mod=document&uid=[1-9]\d{0,11})$/;
const IMAGE_PREFIX = /^https:\/\/sojoong\.kr(?::443)?\/wp-content\/uploads\//;

export function parseProgramNoticeUrl(input: string): URL {
  const prefix = input.match(NOTICE_PREFIX)?.[0];
  if (
    input.length > 2048 ||
    !prefix ||
    !NOTICE_QUERY.test(input.slice(prefix.length)) ||
    !URL.canParse(input)
  ) {
    throw new DomainException(PROGRAM_NOTICE_ERRORS.INVALID_URL);
  }
  const url = new URL(input);
  return new URL(
    `${ORIGIN}/notice/notice-board/?uid=${url.searchParams.get('uid')}&mod=document`,
  );
}

export function parseProgramNoticeImageUrl(
  input: string,
  sourceUrl?: URL,
): URL | null {
  if (input.length > 2048 || /[\s\\?#]/.test(input)) return null;
  const absolute =
    sourceUrl?.origin === ORIGIN &&
    input.startsWith('/') &&
    !input.startsWith('//')
      ? `${ORIGIN}${input}`
      : input;
  const prefix = absolute.match(IMAGE_PREFIX)?.[0];
  if (!prefix || !URL.canParse(absolute)) return null;
  try {
    const segments = absolute
      .slice(prefix.length)
      .split('/')
      .map(decodeURIComponent);
    if (
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          /[\\/%?#\p{Cc}\p{Cf}]/u.test(segment),
      )
    )
      return null;
    const filename = segments.at(-1);
    if (!filename || !/\.(?:jpe?g|png)$/i.test(filename)) return null;
    const url = new URL(
      `${ORIGIN}/wp-content/uploads/${segments.map(encodeURIComponent).join('/')}`,
    );
    // Re-encoding raw non-ASCII names can exceed the 2048-character cover column.
    return url.href.length <= 2048 ? url : null;
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}
