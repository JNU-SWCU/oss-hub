import { createHash } from 'node:crypto';
export class MailJobConfig {
  static digest(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  static seoulDay(now: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}
