import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  GithubWebhookObservationInput,
  GithubWebhookObservationSummary,
  GithubWebhookRepositoryInput,
} from './github-webhook.types';
import { GITHUB_WEBHOOK_OBSERVATION_OUTCOMES } from './github-webhook.types';

export type GithubWebhookPersistResult = 'stored' | 'duplicate';

function assertNever(value: never): never {
  throw new TypeError(
    `unhandled webhook observation variant: ${String(value)}`,
  );
}

function observationErrorCode(
  input: GithubWebhookObservationInput,
): string | null {
  switch (input.outcome) {
    case GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.ACCEPTED:
    case GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.DUPLICATE:
    case GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.IGNORED:
      return null;
    case GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.FAILED:
      return input.errorCode;
    default:
      return assertNever(input);
  }
}

@Injectable()
export class GithubWebhookRepository {
  private readonly logger = new Logger(GithubWebhookRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  private async observeInTransaction(
    transaction: Prisma.TransactionClient,
    input: GithubWebhookObservationInput,
  ): Promise<void> {
    await transaction.githubWebhookObservation.create({
      data: {
        deliveryId: input.deliveryId,
        eventType: input.eventType,
        receivedAt: input.receivedAt,
        outcome: input.outcome,
        errorCode: observationErrorCode(input),
      },
    });
  }

  async observe(input: GithubWebhookObservationInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.observeInTransaction(transaction, input);
    });
  }

  async persist(
    input: GithubWebhookRepositoryInput,
  ): Promise<GithubWebhookPersistResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const duplicate =
          await transaction.orgRepositoryActivityEvent.findFirst({
            where: {
              OR: [
                { deliveryId: input.activity.deliveryId },
                { dedupeKey: input.activity.dedupeKey },
              ],
            },
            select: { id: true },
          });
        if (duplicate !== null) {
          await this.observeInTransaction(transaction, {
            deliveryId: input.activity.deliveryId,
            eventType: input.activity.eventType,
            receivedAt: input.observedAt,
            outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.DUPLICATE,
          });
          return 'duplicate';
        }

        const mappedRepository = await transaction.repository.findUnique({
          where: {
            githubRepositoryId: input.repository.githubRepositoryId,
          },
          select: { id: true },
        });
        const inventory = await transaction.orgRepositoryInventory.upsert({
          where: {
            githubRepositoryId: input.repository.githubRepositoryId,
          },
          create: {
            ...input.repository,
            firstSeenAt: input.observedAt,
            lastSeenAt: input.observedAt,
            repositoryId: mappedRepository?.id ?? null,
          },
          update: {
            fullName: input.repository.fullName,
            visibility: input.repository.visibility,
            archived: input.repository.archived,
            lastSeenAt: input.observedAt,
            ...(mappedRepository === null
              ? {}
              : { repositoryId: mappedRepository.id }),
          },
          select: { id: true },
        });

        await transaction.orgRepositoryActivityEvent.create({
          data: {
            inventoryId: inventory.id,
            ...input.activity,
          },
        });
        await this.observeInTransaction(transaction, {
          deliveryId: input.activity.deliveryId,
          eventType: input.activity.eventType,
          receivedAt: input.observedAt,
          outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.ACCEPTED,
        });
        return 'stored';
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate =
          await this.prisma.orgRepositoryActivityEvent.findFirst({
            where: {
              OR: [
                { deliveryId: input.activity.deliveryId },
                { dedupeKey: input.activity.dedupeKey },
              ],
            },
            select: { id: true },
          });
        if (duplicate !== null) {
          await this.observeBestEffort({
            deliveryId: input.activity.deliveryId,
            eventType: input.activity.eventType,
            receivedAt: input.observedAt,
            outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.DUPLICATE,
          });
          return 'duplicate';
        }
      }
      throw error;
    }
  }

  private async observeBestEffort(
    input: GithubWebhookObservationInput,
  ): Promise<void> {
    try {
      await this.observe(input);
    } catch (error: unknown) {
      // no-excuse-ok: catch — 중복 관측 실패는 이미 판정된 멱등 결과를 바꾸지 않는다.
      this.logger.warn({
        event: 'collection.webhook.observation_failed',
        outcome: input.outcome,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  async summarizeSince(since: Date): Promise<GithubWebhookObservationSummary> {
    const [latest, accepted, duplicate, ignored, failed] =
      await this.prisma.$transaction([
        this.prisma.githubWebhookObservation.findFirst({
          orderBy: { receivedAt: 'desc' },
          select: { receivedAt: true },
        }),
        this.prisma.githubWebhookObservation.count({
          where: {
            outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.ACCEPTED,
            receivedAt: { gte: since },
          },
        }),
        this.prisma.githubWebhookObservation.count({
          where: {
            outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.DUPLICATE,
            receivedAt: { gte: since },
          },
        }),
        this.prisma.githubWebhookObservation.count({
          where: {
            outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.IGNORED,
            receivedAt: { gte: since },
          },
        }),
        this.prisma.githubWebhookObservation.count({
          where: {
            outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.FAILED,
            receivedAt: { gte: since },
          },
        }),
      ]);
    return {
      lastReceivedAt: latest?.receivedAt ?? null,
      counts: { accepted, duplicate, ignored, failed },
    };
  }
}
