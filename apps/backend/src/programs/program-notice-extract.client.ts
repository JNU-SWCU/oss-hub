import { Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';
import { ProgramNoticeHtmlClient } from './program-notice-html.client';
import { ProgramNoticeUrlClient } from './program-notice-url.client';
import { ProgramNoticeCandidatesClient } from './program-notice-candidates.client';
import type {
  ProgramNoticePreview,
  ProgramNoticeWarning,
} from './program-notice.types';
@Injectable()
export class ProgramNoticeExtractClient {
  constructor(
    private readonly html: ProgramNoticeHtmlClient,
    private readonly urls: ProgramNoticeUrlClient,
    private readonly candidates: ProgramNoticeCandidatesClient,
  ) {}
  extract(html: string, sourceUrl: URL): ProgramNoticePreview {
    if (html.length > 2 * 1024 * 1024)
      throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
    const document = this.html.document(html);
    const titleRoot = document.find((node) =>
      this.html.hasClass(node, 'kboard-title'),
    );
    const title =
      titleRoot &&
      this.html.elements(titleRoot).find((node) => node.tagName === 'h1');
    const contentRoot = document.find((node) =>
      this.html.hasClass(node, 'kboard-content'),
    );
    const body =
      contentRoot &&
      this.html
        .elements(contentRoot)
        .find((node) => this.html.hasClass(node, 'content-view'));
    if (!title || !body)
      throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
    const name = this.html
      .cleanText(this.html.noticeText(title, sourceUrl))
      .replace(/\s+/g, ' ');
    const description = this.html.cleanText(
      this.html.noticeText(body, sourceUrl),
    );
    const coverImages = [
      ...new Set(
        this.html
          .elements(body)
          .filter((node) => node.tagName === 'img')
          .map(
            (node) =>
              (
                this.urls.parseProgramNoticeImageUrl(
                  this.html.attribute(node, 'src'),
                  sourceUrl,
                ) ??
                this.urls.parseProgramNoticeImageUrl(
                  this.html.attribute(node, 'data-src'),
                  sourceUrl,
                )
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
      candidates: this.candidates.extract(description),
    };
  }
}
