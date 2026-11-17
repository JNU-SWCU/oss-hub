import type { AdminOrigin } from '@prisma/client';
import type { AdminAccessUserDetail } from '../../users/admin-access-read-ordering.repository';

const ADMIN_GRANT_TIME_MEANINGS = {
  MIGRATION: 'MIGRATED_QUALIFICATION_CREATED',
  ADMIN: 'GRANTED',
  BOOTSTRAP: 'GRANTED',
} as const satisfies Readonly<Record<AdminOrigin, string>>;

export class AdminGrantResponseDto {
  declare readonly origin: AdminOrigin;
  declare readonly grantedAt: string;
  declare readonly grantTimeMeaning: (typeof ADMIN_GRANT_TIME_MEANINGS)[AdminOrigin];

  static from(
    grant: NonNullable<AdminAccessUserDetail['adminGrant']>,
  ): AdminGrantResponseDto {
    return {
      origin: grant.origin,
      grantedAt: grant.grantedAt.toISOString(),
      grantTimeMeaning: ADMIN_GRANT_TIME_MEANINGS[grant.origin],
    };
  }
}
