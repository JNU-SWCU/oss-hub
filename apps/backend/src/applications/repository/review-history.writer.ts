import { ApplicationReviewEventKind } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export type ReviewHistoryWriterClient = Pick<
  Prisma.TransactionClient,
  'application' | 'applicationReviewHistory'
>;

export interface AppendReviewHistoryInput {
  readonly applicationId: string;
  readonly eventKind: ApplicationReviewEventKind;

  readonly actorId: string;
  readonly occurredAt: Date;

  readonly rejectionReason: string | null;
}

export interface AppendedReviewHistory {
  readonly revision: number;
}

export class ApplicationReviewHistoryTargetMissingError extends Error {
  override readonly name = 'ApplicationReviewHistoryTargetMissingError';

  constructor(readonly applicationId: string) {
    super('append 대상 신청을 찾을 수 없다');
  }
}

export async function appendReviewHistory(
  client: ReviewHistoryWriterClient,
  input: AppendReviewHistoryInput,
): Promise<AppendedReviewHistory> {
  const revision = await resolveRevision(client, input);
  await client.applicationReviewHistory.create({
    data: {
      applicationId: input.applicationId,
      eventKind: input.eventKind,
      revision,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      rejectionReason:
        input.eventKind === ApplicationReviewEventKind.REJECTED
          ? input.rejectionReason
          : null,
    },
  });
  return { revision };
}

async function resolveRevision(
  client: ReviewHistoryWriterClient,
  input: AppendReviewHistoryInput,
): Promise<number> {
  if (input.eventKind === ApplicationReviewEventKind.RESUBMITTED) {
    const bumped = await client.application.update({
      where: { id: input.applicationId },
      data: { revision: { increment: 1 } },
      select: { revision: true },
    });
    return bumped.revision;
  }
  const current = await client.application.findUnique({
    where: { id: input.applicationId },
    select: { revision: true },
  });
  if (current === null) {
    throw new ApplicationReviewHistoryTargetMissingError(input.applicationId);
  }
  return current.revision;
}
