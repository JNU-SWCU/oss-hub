import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { GithubWebhookRepositoryInput } from './github-webhook.types';

export type GithubWebhookPersistResult = 'stored' | 'duplicate';

@Injectable()
export class GithubWebhookRepository {
  constructor(private readonly prisma: PrismaService) {}

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
          return 'duplicate';
        }
      }
      throw error;
    }
  }
}
