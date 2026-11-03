import {
  APPROVAL_TRANSITION_EVENTS,
  USER_APPROVAL_SELECT,
} from './user-history.config';
import { UserTransitionRepository } from './user-transition.repository';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UserHistoryEvent, Prisma } from '@prisma/client';
import { type UserAuditInput } from './user-history.types';

export type UserHistoryTransaction = Pick<
  Prisma.TransactionClient,
  'user' | 'userHistory' | 'adminHistory'
>;

@Injectable()
export class UserHistoryRepository {
  constructor(private readonly transitions: UserTransitionRepository) {}
  async record(
    input: UserAuditInput,
    transaction: UserHistoryTransaction,
  ): Promise<void> {
    const actor = await transaction.user.findUniqueOrThrow({
      where: { githubId: input.actorGithubId },
      select: { id: true },
    });
    const user = await transaction.user.findUniqueOrThrow({
      where:
        input.targetType === 'ROLE_REQUEST'
          ? { approvalRequestId: input.targetId }
          : { id: input.targetId },
      select: { id: true, ...USER_APPROVAL_SELECT },
    });
    const data = {
      schemaVersion: 1,
      recordKind: 'DOMAIN_EVENT',
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    } as const;
    const adminEvent = this.adminEvent(input);
    if (adminEvent !== null) {
      await transaction.adminHistory.create({
        data: {
          id: `admin:${randomUUID()}`,
          userId: user.id,
          actorId: actor.id,
          event: adminEvent,
          source: 'APPLICATION',
          data: { ...data, request: null },
        },
      });
      return;
    }
    const event = this.userEvent(input);
    await transaction.userHistory.create({
      data: {
        id: `user:${randomUUID()}`,
        userId: user.id,
        actorId: actor.id,
        event,
        source: 'APPLICATION',
        data: {
          ...data,
          request: APPROVAL_TRANSITION_EVENTS.includes(event)
            ? this.transitions.requestSnapshot(user)
            : null,
        },
      },
    });
  }

  private adminEvent(input: UserAuditInput): 'GRANTED' | 'REVOKED' | null {
    switch (input.action) {
      case 'GRANT_ADMIN_ACCESS':
        return 'GRANTED';
      case 'REVOKE_ADMIN_ACCESS':
        return 'REVOKED';
      case 'USER_ROLE_CHANGED':
        if (
          'eventKind' in input.metadata &&
          input.metadata.eventKind === 'DIRECT_ROLE_CHANGED'
        ) {
          if (
            input.metadata.before.role !== 'ADMIN' &&
            input.metadata.after.role === 'ADMIN'
          ) {
            return 'GRANTED';
          }
          if (
            input.metadata.before.role === 'ADMIN' &&
            input.metadata.after.role !== 'ADMIN'
          ) {
            return 'REVOKED';
          }
        }
        return null;
      default:
        return null;
    }
  }

  private userEvent(input: UserAuditInput): UserHistoryEvent {
    const action = input.action;
    switch (action) {
      case 'STAFF_ROLE_REQUEST_APPROVED':
      case 'STAFF_ROLE_REQUEST_RESTORED':
      case 'GRANT_STAFF_ACCESS':
        return 'APPROVED';
      case 'STAFF_ROLE_REQUEST_REJECTED':
        return 'REJECTED';
      case 'STAFF_ROLE_REQUEST_REVOKED':
      case 'REVOKE_STAFF_ACCESS':
        return 'REVOKED';
      case 'USER_ROLE_CHANGED':
        return 'eventKind' in input.metadata &&
          input.metadata.eventKind === 'DIRECT_ROLE_CHANGED' &&
          input.metadata.before.role !== 'STUDENT' &&
          input.metadata.after.role === 'STAFF'
          ? 'APPROVED'
          : 'TYPE_CHANGED';
      case 'USER_ACCOUNT_STATUS_CHANGED':
        return 'ACCOUNT_STATUS_CHANGED';
      case 'USER_PROFILE_UPDATED':
        return 'PROFILE_UPDATED';
      case 'USER_PHONE_UPDATED':
        return 'PHONE_UPDATED';
      default:
        throw new TypeError(`Unsupported user audit action: ${action}`);
    }
  }
}
