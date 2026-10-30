import type { AccountStatus } from '@prisma/client';

export interface AccountDeactivationResult {
  readonly accountStatus: typeof AccountStatus.DEACTIVATED;
}
