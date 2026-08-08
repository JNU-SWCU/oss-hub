import { AccountStatus } from '@prisma/client';
import type { AccountDeactivationResult } from '../account-deactivation.service';

export class AccountDeactivationResponseDto {
  readonly accountStatus: typeof AccountStatus.DEACTIVATED;

  constructor(result: AccountDeactivationResult) {
    this.accountStatus = result.accountStatus;
  }
}
