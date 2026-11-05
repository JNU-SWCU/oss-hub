import { Injectable } from '@nestjs/common';
import type { Prisma, ProgramHistoryEvent } from '@prisma/client';

export type ProgramHistoryWriterClient = Pick<
  Prisma.TransactionClient,
  'user' | 'programHistory'
>;

export interface AppendProgramHistoryInput {
  readonly programId: string;
  readonly actorGithubId: bigint;
  readonly event: ProgramHistoryEvent;
  readonly metadata: Prisma.InputJsonObject;
}

@Injectable()
export class ProgramHistoryRepository {
  async append(
    client: ProgramHistoryWriterClient,
    input: AppendProgramHistoryInput,
  ): Promise<void> {
    const actor = await client.user.findUniqueOrThrow({
      where: { githubId: input.actorGithubId },
      select: { id: true },
    });
    await client.programHistory.create({
      data: {
        programId: input.programId,
        actorId: actor.id,
        event: input.event,
        source: 'APPLICATION',
        data: { schemaVersion: 1, metadata: input.metadata },
      },
    });
  }
}
