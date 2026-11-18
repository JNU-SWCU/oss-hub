import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ProgramMailSendRepository } from './program-mail-send.repository';
import type {
  ProgramMailProcessResult,
  ProgramMailRecipient,
} from './program-mail-send.types';
import { ProgramMailWorkerService } from './program-mail-worker.service';

export type ProgramMailDelivery = {
  readonly actorId: string;
  readonly programId: string;
  readonly programName: string;
  readonly senderName: string;
  readonly subject: string;
  readonly body: string;
  readonly previewVersion: string;
  readonly occurredAt: Date;
  readonly recipients: readonly ProgramMailRecipient[];
};

@Injectable()
export class ProgramMailDeliveryService {
  constructor(
    @Inject(ProgramMailSendRepository)
    private readonly repository: Pick<ProgramMailSendRepository, 'reserve'>,
    @Inject(ProgramMailWorkerService)
    private readonly worker: Pick<ProgramMailWorkerService, 'process'>,
  ) {}

  async send(input: ProgramMailDelivery): Promise<ProgramMailProcessResult> {
    const reservation = await this.repository.reserve({
      actorId: input.actorId,
      programId: input.programId,
      programName: input.programName,
      senderName: input.senderName,
      recipients: input.recipients,
      subject: input.subject,
      body: input.body,
      bodyHash: createHash('sha256').update(input.body).digest('hex'),
      bodyLength: input.body.length,
      previewVersion: input.previewVersion,
      occurredAt: input.occurredAt,
    });
    return reservation.kind === 'OWNER'
      ? this.worker.process(reservation.batchKey, input.occurredAt)
      : reservation;
  }
}
