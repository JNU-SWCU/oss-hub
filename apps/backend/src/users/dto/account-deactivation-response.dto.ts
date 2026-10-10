import { AccountStatus } from '@prisma/client';
import type { AccountDeactivationResult } from '../domain/account-deactivation';

export class AccountDeactivationResponseDto {
  readonly accountStatus: typeof AccountStatus.DEACTIVATED;

  constructor(result: AccountDeactivationResult) {
    this.accountStatus = result.accountStatus;
  }
}
