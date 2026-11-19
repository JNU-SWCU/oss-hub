export type ProgramMailDeliveryResult = {
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
  readonly unknownCount: number;
};

export type ProgramMailClock = () => Date;

export type ProgramMailRecipient = {
  readonly id: string;
  readonly displayName: string;
  readonly notificationEmail: string;
};

export type ProgramMailBatchContent = {
  readonly actorId: string;
  readonly programId: string;
  readonly programName: string;
  readonly senderName: string;
  readonly recipients: readonly ProgramMailRecipient[];
  readonly subject: string;
  readonly body: string;
  readonly bodyHash: string;
  readonly bodyLength: number;
  readonly previewVersion: string;
  readonly occurredAt: Date;
};

export type ProgramMailReservation = { readonly jobId: string } & (
  | { readonly kind: 'OWNER'; readonly batchKey: string }
  | ProgramMailProcessResult
);

export type ProgramMailProcessResult =
  | { readonly kind: 'IN_PROGRESS'; readonly batchKey: string }
  | {
      readonly kind: 'COMPLETED';
      readonly batchKey: string;
      readonly result: ProgramMailDeliveryResult;
    };

export type ProgramMailBatchWork = ProgramMailBatchContent & {
  readonly batchKey: string;
  readonly workerId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly deliveryAllowed: boolean;
};
