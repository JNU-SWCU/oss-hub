import { USER_APPROVAL_SELECT } from './user-history.config';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  type ApprovalRecord,
  type RequestSnapshot,
} from './user-history.types';
import { DomainException } from '../platform/error-code.error';
import { ROLES_ERROR_CODES, RolesErrorCode } from './roles-error-code.error';

const EMPTY_APPROVAL = {
  approvalRequestId: null,
  approvalRequestedAt: null,
  approvalDecidedAt: null,
  approvalDecidedById: null,
  approvalReason: null,
} as const;

@Injectable()
export class UserTransitionRepository {
  requestSnapshot(user: ApprovalRecord): RequestSnapshot | null {
    if (user.approvalRequestId === null || user.approvalRequestedAt === null)
      return null;
    switch (user.approvalStatus) {
      case 'NOT_REQUIRED':
        return null;
      case 'PENDING':
      case 'APPROVED':
      case 'REJECTED':
      case 'REVOKED':
        return {
          id: user.approvalRequestId,
          userId: user.id,
          status: user.approvalStatus,
          createdAt: user.approvalRequestedAt.toISOString(),
          decidedAt: user.approvalDecidedAt?.toISOString() ?? null,
          decidedById: user.approvalDecidedById,
          rejectionReason: user.approvalReason,
        };
      default:
        throw new TypeError('Unsupported approval status');
    }
  }

  async lock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
    );
  }

  async requestStaffAccess(
    transaction: Prisma.TransactionClient,
    userId: string,
  ) {
    await this.lock(transaction, userId);
    const before = await transaction.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        department: true,
        profileCreatedAt: true,
        ...USER_APPROVAL_SELECT,
      },
    });
    if (
      before.type !== 'STAFF' ||
      before.profileCreatedAt === null ||
      !before.name?.trim() ||
      !before.department?.trim()
    ) {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.INVALID_ROLE_SELECTION],
      );
    }
    const current = this.requestSnapshot(before);
    if (current?.status === 'PENDING') return current;
    const now = new Date();
    const user = await transaction.user.update({
      where: { id: userId },
      data: {
        ...EMPTY_APPROVAL,
        approvalStatus: 'PENDING',
        approvalRequestId: randomUUID(),
        approvalRequestedAt: now,
      },
      select: { id: true, ...USER_APPROVAL_SELECT },
    });
    const request = this.requestSnapshot(user);
    if (!request)
      throw new TypeError('A submitted approval requires a request identity.');
    await transaction.userHistory.create({
      data: {
        id: `user:${randomUUID()}`,
        userId,
        actorId: userId,
        event: 'APPROVAL_REQUESTED',
        source: 'APPLICATION',
        occurredAt: now,
        data: { schemaVersion: 1, recordKind: 'REQUEST_TRANSITION', request },
      },
    });
    return request;
  }

  async revoke(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly actorId: string;
      readonly decidedAt: Date;
    },
  ): Promise<{ readonly id: string }> {
    const before: ApprovalRecord = await transaction.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { id: true, ...USER_APPROVAL_SELECT },
    });
    if (before.type !== 'STAFF') {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.ACCESS_STATE_MISMATCH],
      );
    }
    await transaction.user.update({
      where: { id: input.userId },
      data: {
        approvalStatus: 'REVOKED',
        approvalDecidedAt: input.decidedAt,
        approvalDecidedById: input.actorId,
        approvalReason: null,
      },
    });
    return { id: before.approvalRequestId ?? input.userId };
  }
}
