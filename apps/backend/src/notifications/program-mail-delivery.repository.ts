import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { ProgramMailStoredResultError } from './program-mail-send-state.error';

export type ProgramMailDeliveryResult = {
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};

export type ProgramMailDeliveryStore = {
  key(previewVersion: string, userId: string): string;
  claimNotification(
    userId: string,
    idempotencyKey: string,
    payload: Prisma.InputJsonValue,
  ): Promise<boolean>;
  completeNotification(
    idempotencyKey: string,
    status: 'SENT' | 'FAILED',
    payload: Prisma.InputJsonValue,
  ): Promise<void>;
};

@Injectable()
export class ProgramMailDeliveryRepository implements ProgramMailDeliveryStore {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  key(previewVersion: string, userId: string): string {
    return `program-mail:${previewVersion}:${userId}`;
  }

  async claimNotification(
    userId: string,
    idempotencyKey: string,
    payload: Prisma.InputJsonValue,
  ): Promise<boolean> {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          idempotencyKey,
          type: 'PROGRAM_MAIL',
          payload,
          channel: 'EMAIL',
          status: 'PENDING',
        },
      });
      return true;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  async completeNotification(
    idempotencyKey: string,
    status: 'SENT' | 'FAILED',
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.notification.update({
      where: { idempotencyKey },
      data: {
        status,
        payload,
        sentAt: status === 'SENT' ? new Date() : null,
      },
    });
  }

  async result(
    previewVersion: string,
    recipientIds: readonly string[],
  ): Promise<ProgramMailDeliveryResult> {
    const keys = recipientIds.map((userId) => this.key(previewVersion, userId));
    const rows = await this.prisma.notification.findMany({
      take: keys.length + 1,
      where: { idempotencyKey: { in: keys } },
      select: { status: true },
      orderBy: { idempotencyKey: 'asc' },
    });
    if (rows.length !== keys.length) {
      throw new ProgramMailStoredResultError(
        `program-mail-send:${previewVersion}`,
      );
    }
    const sentCount = rows.filter((row) => row.status === 'SENT').length;
    const failedCount = rows.filter((row) => row.status === 'FAILED').length;
    return {
      sentCount,
      failedCount,
      duplicateCount: rows.length - sentCount - failedCount,
    };
  }
}
