import { Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';
import { ProgramNoticeHtmlClient } from './program-notice-html.client';
import { ProgramNoticeUrlClient } from './program-notice-url.client';
import { PROGRAM_NOTICE_LIST_URL } from './program-notice.config';
import type { ProgramNoticeList } from './program-notice.types';
@Injectable()
export class ProgramNoticeListClient {
  constructor(
    private readonly html: ProgramNoticeHtmlClient,
    private readonly urls: ProgramNoticeUrlClient,
  ) {}
  extract(html: string): ProgramNoticeList {
    if (html.length > 2 * 1024 * 1024)
      throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
    const source = new URL(PROGRAM_NOTICE_LIST_URL);
    const list = this.html
      .document(html)
      .find((node) => this.html.hasClass(node, 'kboard-list'));
    if (!list)
      throw new DomainException(PROGRAM_NOTICE_ERRORS.UNSUPPORTED_CONTENT);
    const items: ProgramNoticeList['items'][number][] = [];
    for (const row of this.html
      .elements(list)
      .filter((node) => node.tagName === 'tr')) {
      const nodes = this.html.elements(row);
      const link = nodes.find((node) => node.tagName === 'a');
      const date = nodes.find(
        (node) =>
          node.tagName === 'span' &&
          this.html.hasClass(node, 'kboard-date') &&
          /^\d{4}\.\d{2}\.\d{2}$/.test(
            this.html.cleanText(this.html.noticeText(node, source)),
          ),
      );
      if (!link || !date) continue;
      const href = this.html.attribute(link, 'href');
      if (!URL.canParse(href, source)) continue;
      let url: URL;
      try {
        url = this.urls.parseProgramNoticeUrl(new URL(href, source).href);
      } catch (error) {
        if (error instanceof DomainException) continue;
        throw error;
      }
      const titleNode = this.html
        .elements(link)
        .find((node) => this.html.hasClass(node, 'custom-title'));
      if (!titleNode) continue;
      const title = this.html
        .cleanText(this.html.noticeText(titleNode, source))
        .replace(/\s+/g, ' ');
      const postedAt = this.html
        .cleanText(this.html.noticeText(date, source))
        .replaceAll('.', '-');
      const parsed = new Date(postedAt);
      if (
        !title ||
        title.length > 200 ||
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== postedAt
      )
        continue;
      const thumbnailUrl =
        nodes
          .filter((node) => node.tagName === 'img')
          .map(
            (node) =>
              (
                this.urls.parseProgramNoticeImageUrl(
                  this.html.attribute(node, 'src'),
                  source,
                ) ??
                this.urls.parseProgramNoticeImageUrl(
                  this.html.attribute(node, 'data-src'),
                  source,
                )
              )?.href,
          )
          .find((value) => value !== undefined) ?? null;
      if (!items.some((item) => item.url === url.href))
        items.push({ url: url.href, title, postedAt, thumbnailUrl });
    }
    return {
      items: items
        .sort(
          (a, b) =>
            b.postedAt.localeCompare(a.postedAt) ||
            Number(new URL(b.url).searchParams.get('uid')) -
              Number(new URL(a.url).searchParams.get('uid')),
        )
        .slice(0, 10),
    };
  }
}
