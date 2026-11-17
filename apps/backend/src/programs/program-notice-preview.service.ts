import { Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code.error';
import {
  ProgramNoticeFetchClient,
  type ProgramNoticePreview,
} from './program-notice-fetch.client';
import { PROGRAM_NOTICE_LIST_URL } from './program-notice.config';
import type { ProgramNoticeList } from './program-notice.types';

@Injectable()
export class ProgramNoticePreviewService {
  private active = 0;
  private attempts: { readonly actorId: string; readonly at: number }[] = [];

  constructor(private readonly client: ProgramNoticeFetchClient) {}

  preview(actorId: string, input: string): Promise<ProgramNoticePreview> {
    const source = this.client.parseProgramNoticeUrl(input);
    return this.limited(actorId, async () =>
      this.client.extractProgramNotice(await this.client.read(source), source),
    );
  }

  list(actorId: string): Promise<ProgramNoticeList> {
    return this.limited(actorId, async () => {
      const deadline = Date.now() + 8000;
      const list = this.client.extractProgramNoticeList(
        await this.client.read(new URL(PROGRAM_NOTICE_LIST_URL)),
      );
      const items: ProgramNoticeList['items'][number][] = [];
      for (const item of list.items) {
        const remaining = deadline - Date.now();
        if (item.thumbnailUrl || remaining <= 0) {
          items.push(item);
          continue;
        }
        try {
          const source = this.client.parseProgramNoticeUrl(item.url);
          const preview = this.client.extractProgramNotice(
            await this.client.read(source, undefined, remaining),
            source,
          );
          items.push({ ...item, thumbnailUrl: preview.coverImages[0] ?? null });
        } catch (error) {
          if (!(error instanceof DomainException)) throw error;
          items.push(item);
        }
      }
      return { items };
    });
  }

  private async limited<T>(
    actorId: string,
    read: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    this.attempts = this.attempts.filter(
      (attempt) => attempt.at > now - 60_000,
    );
    if (
      this.active >= 4 ||
      this.attempts.length >= 60 ||
      this.attempts.filter((attempt) => attempt.actorId === actorId).length >= 6
    )
      throw new DomainException(PROGRAM_NOTICE_ERRORS.RATE_LIMITED);
    this.attempts.push({ actorId, at: now });
    this.active++;
    try {
      return await read();
    } finally {
      this.active--;
    }
  }
}
