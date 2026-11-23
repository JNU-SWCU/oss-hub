import { Injectable } from '@nestjs/common';
import type { MailSender } from './gmail-mail.client';
import {
  MailJobClaimRepository,
  type MailEligibility,
} from './mail-job-claim.repository';
@Injectable()
export class MailJobWorkerService {
  constructor(
    private readonly claims: MailJobClaimRepository,
    private readonly sender: MailSender,
    private readonly digest: MailEligibility,
  ) {}
  recover() {
    return this.claims.recover();
  }
  async step() {
    const work = await this.claims.claim(this.digest);
    if (!work) return false;
    if (!work.mail) return true;
    let state: 'SENT' | 'FAILED' | 'UNKNOWN' = 'SENT';
    try {
      await this.sender.send(work.mail);
    } catch (error) {
      state =
        error &&
        typeof error === 'object' &&
        'responseCode' in error &&
        typeof error.responseCode === 'number' &&
        error.responseCode >= 400 &&
        error.responseCode < 600
          ? 'FAILED'
          : 'UNKNOWN';
    }
    await this.claims.record(work.id, state);
    return true;
  }
}
