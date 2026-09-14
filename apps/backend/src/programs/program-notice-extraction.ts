import { parse } from 'parse5';
import { DomainException } from '../common/error-code';
import {
  attribute,
  cleanText,
  elements,
  hasClass,
  noticeText,
  noticeTreeAdapter,
} from './program-notice-dom';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code';
import { parseProgramNoticeImageUrl } from './program-notice-url';

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
