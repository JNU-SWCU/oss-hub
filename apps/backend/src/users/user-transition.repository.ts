import { USER_APPROVAL_SELECT } from './user-history.config';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  type ApprovalRecord,
  type ApprovalState,
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

  async changeType(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly actorId: string;
      readonly expected: ApprovalState;
      readonly profile: {
        readonly memberKind: 'STUDENT' | 'STAFF';
        readonly studentId?: string;
        readonly department?: string;
        readonly departmentType?: 'DEPARTMENT' | 'PROGRAM_OFFICE';
        readonly staffNumber?: string | null;
      };
    },
  ): Promise<ApprovalState | null> {
    const before = await transaction.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: {
        id: true,
        studentId: true,
        department: true,
        departmentType: true,
        staffNumber: true,
        ...USER_APPROVAL_SELECT,
      },
    });
    const now = new Date();
    const approves =
      input.profile.memberKind === 'STAFF' &&
      (before.type !== 'STAFF' || before.approvalStatus !== 'APPROVED');
    const requestId =
      input.profile.memberKind === 'STAFF'
        ? approves
          ? randomUUID()
          : before.approvalRequestId
        : null;
    const changed = await transaction.user.updateMany({
      where: { id: input.userId, ...input.expected },
      data: {
        type: input.profile.memberKind,
        ...(input.profile.memberKind === 'STUDENT'
          ? { ...EMPTY_APPROVAL, approvalStatus: 'NOT_REQUIRED' }
          : {}),
        ...(approves
          ? {
              ...EMPTY_APPROVAL,
              approvalStatus: 'APPROVED',
              approvalRequestId: requestId,
              approvalRequestedAt: now,
              approvalDecidedAt: now,
              approvalDecidedById: input.actorId,
            }
          : {}),
        ...(input.profile.studentId === undefined
          ? {}
          : { studentId: input.profile.studentId }),
        ...(input.profile.department === undefined
          ? {}
          : { department: input.profile.department }),
        ...(input.profile.departmentType === undefined
          ? {}
          : { departmentType: input.profile.departmentType }),
        ...(input.profile.staffNumber === undefined
          ? {}
          : { staffNumber: input.profile.staffNumber }),
        ...((input.profile.studentId !== undefined &&
          input.profile.studentId !== before.studentId) ||
        (input.profile.department !== undefined &&
          input.profile.department !== before.department) ||
        (input.profile.departmentType !== undefined &&
          input.profile.departmentType !== before.departmentType) ||
        (input.profile.staffNumber !== undefined &&
          input.profile.staffNumber !== before.staffNumber)
          ? { profileUpdatedAt: now }
          : {}),
      },
    });
    if (changed.count !== 1) return null;
    const previousRequest = this.requestSnapshot(before);
    if (previousRequest?.status === 'PENDING') {
      await transaction.userHistory.create({
        data: {
          id: `user:${randomUUID()}`,
          userId: input.userId,
          actorId: input.actorId,
          event: 'REQUEST_SUPERSEDED',
          source: 'APPLICATION',
          occurredAt: now,
          data: {
            schemaVersion: 1,
            recordKind: 'REQUEST_TRANSITION',
            cause: 'SUPERSEDED',
            replacementRequestId: requestId,
            request: {
              ...previousRequest,
              status: 'REVOKED',
              decidedAt: now.toISOString(),
              decidedById: input.actorId,
            },
          },
        },
      });
    } else if (previousRequest?.status === 'APPROVED' && requestId === null) {
      await transaction.userHistory.create({
        data: {
          id: `user:${randomUUID()}`,
          userId: input.userId,
          actorId: input.actorId,
          event: 'REVOKED',
          source: 'APPLICATION',
          occurredAt: now,
          data: {
            schemaVersion: 1,
            recordKind: 'REQUEST_TRANSITION',
            cause: 'TYPE_CHANGED',
            request: {
              ...previousRequest,
              status: 'REVOKED',
              decidedAt: now.toISOString(),
              decidedById: input.actorId,
            },
          },
        },
      });
    }
    if (approves && requestId !== null) {
      await transaction.userHistory.create({
        data: {
          id: `user:${randomUUID()}`,
          userId: input.userId,
          actorId: input.actorId,
          event: 'APPROVED',
          source: 'APPLICATION',
          occurredAt: now,
          data: {
            schemaVersion: 1,
            recordKind: 'REQUEST_TRANSITION',
            cause: 'ADMIN_TYPE_CHANGE',
            request: {
              id: requestId,
              userId: input.userId,
              status: 'APPROVED',
              createdAt: now.toISOString(),
              decidedAt: now.toISOString(),
              decidedById: input.actorId,
              rejectionReason: null,
            },
          },
        },
      });
    }
    return {
      type: input.profile.memberKind,
      approvalStatus:
        input.profile.memberKind === 'STAFF' ? 'APPROVED' : 'NOT_REQUIRED',
      approvalRequestId: requestId,
    };
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
