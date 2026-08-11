import type {
  DeadlineDigestMail,
  MailSender,
} from '../notifications/mail-sender.port';
import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  E2eExternalPortFailure,
  type E2eExternalPortRegistry,
} from './e2e-external-port-registry';

export class E2eFakeMailSender implements MailSender {
  constructor(private readonly registry: E2eExternalPortRegistry) {}

  send(mail: DeadlineDigestMail): Promise<void> {
    if (this.registry.consume(E2E_EXTERNAL_FAILURE_OPERATIONS.SMTP_SEND)) {
      return Promise.reject(
        new E2eExternalPortFailure(E2E_EXTERNAL_FAILURE_OPERATIONS.SMTP_SEND),
      );
    }
    this.registry.recordMail(mail.subject, mail.body);
    return Promise.resolve();
  }
}
