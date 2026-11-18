import { Inject, Injectable } from '@nestjs/common';
import {
  type DeadlineDigestMail,
  type MailOperation,
  type MailSender,
  MAIL_SENDER,
} from './gmail-mail.client';
import {
  PROGRAM_MAIL_BATCH_DEADLINE_MS,
  PROGRAM_MAIL_BATCH_DRAIN_MS,
} from './program-mail.config';
import type { ProgramMailRecipientDeliveryState } from './program-mail-delivery.repository';
import type { ProgramMailBatchWork } from './program-mail-send.types';
import { ProgramMailTemplateService } from './program-mail-template.service';

export type ProgramMailBatchScope = {
  readonly signal: AbortSignal;
  readonly send: (
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
  ) => Promise<void>;
};

export type ProgramMailBatchTaskResult<Result> =
  | { readonly status: 'fulfilled'; readonly value: Result }
  | { readonly status: 'rejected'; readonly reason: unknown }
  | { readonly status: 'unsettled' };

@Injectable()
export class ProgramMailTransportService {
  constructor(
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
    private readonly template: ProgramMailTemplateService,
  ) {}

  async runBatch<Result>(
    tasks: readonly ((scope: ProgramMailBatchScope) => Promise<Result>)[],
  ): Promise<readonly ProgramMailBatchTaskResult<Result>[]> {
    const controller = new AbortController();
    const operations = new Set<MailOperation>();
    const results: (ProgramMailBatchTaskResult<Result> | null)[] = tasks.map(
      () => null,
    );
    let resolveAborted: () => void = () => undefined;
    const aborted = new Promise<void>((resolve) => {
      resolveAborted = resolve;
    });
    const abortBatch = (reason: Error) => {
      if (!controller.signal.aborted) {
        controller.abort(reason);
        resolveAborted();
      }
      for (const operation of operations) operation.abort(reason);
    };
    const scope: ProgramMailBatchScope = {
      signal: controller.signal,
      send: (work, state) => {
        controller.signal.throwIfAborted();
        const operation = this.start(work, state, controller.signal);
        operations.add(operation);
        return operation.promise.finally(() => operations.delete(operation));
      },
    };
    const deadline = setTimeout(
      () => abortBatch(new Error('Program mail batch deadline exceeded')),
      PROGRAM_MAIL_BATCH_DEADLINE_MS,
    );
    const taskPromises = tasks.map((task, index) =>
      Promise.resolve()
        .then(() => task(scope))
        .then(
          (value) => {
            results[index] = { status: 'fulfilled', value };
            return value;
          },
          (reason: unknown) => {
            results[index] = { status: 'rejected', reason };
            abortBatch(this.error(reason));
            throw reason;
          },
        ),
    );
    const settled = Promise.allSettled(taskPromises);
    const firstExit = await Promise.race([
      settled.then(() => 'settled' as const),
      aborted.then(() => 'aborted' as const),
    ]);
    let drain: ReturnType<typeof setTimeout> | undefined;
    if (firstExit === 'aborted' && results.some((result) => result === null)) {
      await Promise.race([
        settled.then(() => undefined),
        new Promise<void>((resolve) => {
          drain = setTimeout(resolve, PROGRAM_MAIL_BATCH_DRAIN_MS);
        }),
      ]);
    }
    abortBatch(new Error('Program mail batch closed'));
    clearTimeout(deadline);
    clearTimeout(drain);
    operations.clear();
    return results.map(
      (result): ProgramMailBatchTaskResult<Result> =>
        result ?? { status: 'unsettled' },
    );
  }

  private start(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
    signal: AbortSignal,
  ): MailOperation {
    const mail = this.mail(work, state);
    if (this.mailSender.start !== undefined) return this.mailSender.start(mail);
    return {
      promise: this.mailSender.send(mail, signal),
      abort: () => undefined,
    };
  }

  private mail(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
  ): DeadlineDigestMail {
    const mail = this.template.build({
      subject: work.subject,
      body: work.body,
      displayName: state.recipient.displayName,
      senderName: work.senderName,
      programName: work.programName,
    });
    return {
      to: state.recipient.notificationEmail,
      subject: mail.subject,
      body: mail.text,
      html: mail.html,
    };
  }

  private error(reason: unknown): Error {
    return reason instanceof Error ? reason : new Error('Program mail failed');
  }
}
