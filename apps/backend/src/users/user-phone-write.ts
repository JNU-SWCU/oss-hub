import type { Prisma } from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import {
  USER_PHONE_AUDIT_TRANSITIONS,
  USER_PROFILE_AUDIT_ACTIONS,
  createUserPhoneAuditMetadata,
} from '../audit-log/audit-log-metadata';
import type { UserProfileRecord } from './domain/user-profile';

export type UserPhoneAuditRecord = UserProfileRecord & {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly phone: string | null;
};

export type UserPhoneWriteInput = {
  readonly transaction: Prisma.TransactionClient;
  readonly auditLog?: Pick<AuditLogService, 'record'>;
  readonly user: UserPhoneAuditRecord;
  readonly phone?: string;
};

export function requireUserPhoneAuditRecord(
  user: UserProfileRecord,
): UserPhoneAuditRecord {
  if (
    typeof user.githubId === 'bigint' &&
    typeof user.githubLogin === 'string' &&
    (typeof user.phone === 'string' || user.phone === null)
  ) {
    return {
      ...user,
      githubId: user.githubId,
      githubLogin: user.githubLogin,
      phone: user.phone,
    };
  }
  throw new TypeError(
    'Phone updates require a full user profile record for auditing.',
  );
}

export async function writeUserPhoneIfChanged(
  input: UserPhoneWriteInput,
): Promise<void> {
  if (input.phone === undefined || input.phone === input.user.phone) {
    return;
  }
  if (!input.auditLog) {
    throw new TypeError('AuditLogService is required for phone updates.');
  }
  await input.transaction.user.update({
    where: { id: input.user.id },
    data: { phone: input.phone },
  });
  await input.auditLog.record(
    {
      actorGithubId: input.user.githubId,
      action: USER_PROFILE_AUDIT_ACTIONS.PHONE_UPDATED,
      targetType: 'USER',
      targetId: input.user.id,
      metadata: createUserPhoneAuditMetadata({
        actor: {
          displayName: input.user.name,
          githubLogin: input.user.githubLogin,
        },
        target: {
          displayName: input.user.name,
          githubLogin: input.user.githubLogin,
        },
        transition:
          input.user.phone === null
            ? USER_PHONE_AUDIT_TRANSITIONS.SET
            : USER_PHONE_AUDIT_TRANSITIONS.REPLACED,
      }),
    },
    input.transaction,
  );
}
