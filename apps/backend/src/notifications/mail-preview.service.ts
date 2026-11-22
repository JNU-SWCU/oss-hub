import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MailPreviewService {
  version(value: Readonly<Record<string, unknown>>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  legacyIsCurrent(previewedAt: Date, now: Date, ttlMs: number): boolean {
    return (
      Number.isFinite(previewedAt.getTime()) &&
      previewedAt <= now &&
      now.getTime() <= previewedAt.getTime() + ttlMs
    );
  }
}
