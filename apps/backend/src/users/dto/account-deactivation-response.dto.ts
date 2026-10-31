import { AccountStatus } from '@prisma/client';
import type { AccountDeactivationResult } from '../account-deactivation.service';

export class AccountDeactivationResponseDto {
  declare readonly accountStatus: typeof AccountStatus.DEACTIVATED;

  static from(
    result: AccountDeactivationResult,
  ): AccountDeactivationResponseDto {
    return { accountStatus: result.accountStatus };
  }
}
