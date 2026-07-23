import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GithubWebhookRepository } from './github-webhook.repository';
import type { GithubWebhookRepositoryInput } from './github-webhook.types';

const observedAt = new Date('2026-07-23T00:00:00.000Z');
const input: GithubWebhookRepositoryInput = {
  repository: {
    githubRepositoryId: 9_215_000_001n,
    fullName: 'synthetic-org/synthetic-repository',
    visibility: 'PRIVATE',
    archived: false,
  },
  activity: {
    deliveryId: 'test:215:p2002-delivery',
    eventType: 'push',
    occurredAt: observedAt,
    dedupeKey: 'test:215:p2002-dedupe',
    commitDelta: 1,
    pullRequestDelta: 0,
    starDelta: 0,
  },
  observedAt,
};

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'synthetic',
  });
}

describe('GithubWebhookRepository.persist', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('P2002 경쟁 뒤 관측 저장도 실패하면 원래 duplicate 결과를 유지한다', async () => {
    // Given
    const prisma = new PrismaService();
    jest.spyOn(prisma, '$transaction').mockRejectedValue(uniqueViolation());
    jest
      .spyOn(prisma.orgRepositoryActivityEvent, 'findFirst')
      .mockResolvedValue({
        id: 'synthetic-event',
        inventoryId: 'synthetic-inventory',
        deliveryId: input.activity.deliveryId,
        eventType: input.activity.eventType,
        occurredAt: input.activity.occurredAt,
        dedupeKey: input.activity.dedupeKey,
        commitDelta: input.activity.commitDelta,
        pullRequestDelta: input.activity.pullRequestDelta,
        starDelta: input.activity.starDelta,
      });
    const repository = new GithubWebhookRepository(prisma);
    const observe = jest
      .spyOn(repository, 'observe')
      .mockRejectedValue(new Error('synthetic observation failure'));
    const logger = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    // When
    const result = await repository.persist(input);

    // Then
    expect(result).toBe('duplicate');
    expect(observe).toHaveBeenCalledWith({
      deliveryId: input.activity.deliveryId,
      eventType: input.activity.eventType,
      receivedAt: input.observedAt,
      outcome: 'DUPLICATE',
    });
    expect(logger).toHaveBeenCalledWith({
      event: 'collection.webhook.observation_failed',
      outcome: 'DUPLICATE',
      errorName: 'Error',
    });
  });
});
