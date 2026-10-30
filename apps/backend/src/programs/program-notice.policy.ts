import { DomainException } from '../platform/error-code.error';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';
import { parse } from 'parse5';
import {
  attribute,
  cleanText,
  elements,
  hasClass,
  noticeText,
  noticeTreeAdapter,
} from './program-notice-dom.policy';

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

    return url.href.length <= 2048 ? url : null;
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

export type ProgramNoticeWarning =
  'NO_IMAGE' | 'MULTIPLE_IMAGES' | 'EXTERNAL_APPLICATION_LINK';
export type ProgramNoticePreview = {
  readonly sourceUrl: string;
  readonly name: string;
  readonly description: string;
  readonly coverImages: string[];
  readonly warnings: ProgramNoticeWarning[];
};

export function extractProgramNotice(
  html: string,
  sourceUrl: URL,
): ProgramNoticePreview {
  if (html.length > 2 * 1024 * 1024)
    throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
  const document = elements(parse(html, { treeAdapter: noticeTreeAdapter }));
  const titleRoot = document.find((node) => hasClass(node, 'kboard-title'));
  const title =
    titleRoot && elements(titleRoot).find((node) => node.tagName === 'h1');
  const contentRoot = document.find((node) => hasClass(node, 'kboard-content'));
  const body =
    contentRoot &&
    elements(contentRoot).find((node) => hasClass(node, 'content-view'));
  if (!title || !body)
    throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
  const name = cleanText(noticeText(title, sourceUrl)).replace(/\s+/g, ' ');
  const description = cleanText(noticeText(body, sourceUrl));
  const coverImages = [
    ...new Set(
      elements(body)
        .filter((node) => node.tagName === 'img')
        .map(
          (node) =>
            (
              parseProgramNoticeImageUrl(attribute(node, 'src'), sourceUrl) ??
              parseProgramNoticeImageUrl(attribute(node, 'data-src'), sourceUrl)
            )?.href,
        )
        .filter((url): url is string => url !== undefined),
    ),
  ].slice(0, 20);
  if (
    !name ||
    name.length > 200 ||
    description.length > 10_000 ||
    (!description && !coverImages.length)
  )
    throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
  const warnings: ProgramNoticeWarning[] = [];
  if (!coverImages.length) warnings.push('NO_IMAGE');
  if (coverImages.length > 1) warnings.push('MULTIPLE_IMAGES');
  if (
    /신청|접수|등록|register|registration|apply|application|education_single/i.test(
      description,
    )
  )
    warnings.push('EXTERNAL_APPLICATION_LINK');
  return {
    sourceUrl: sourceUrl.href,
    name,
    description,
    coverImages,
    warnings,
  };
}
