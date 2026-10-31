import { AccountStatus } from '@prisma/client';
import type { AccountDeactivationResult } from '../users.types';

export class AccountDeactivationResponseDto {
  declare readonly accountStatus: typeof AccountStatus.DEACTIVATED;

  static from(
    result: AccountDeactivationResult,
  ): AccountDeactivationResponseDto {
    return { accountStatus: result.accountStatus };
  }
}
