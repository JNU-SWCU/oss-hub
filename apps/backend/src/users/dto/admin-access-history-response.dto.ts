import type { LoginHistoryEvent, RoleRequestStatus } from '@prisma/client';
import type { AdminAccessUserHistory } from '../domain/admin-access';

type RoleRequestHistoryItemResponseDto = {
  readonly id: string;
  readonly status: RoleRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly createdAt: string;
};

type LoginHistoryItemResponseDto = {
  readonly id: string;
  readonly event: LoginHistoryEvent;
  readonly provider: 'github';
  readonly success: boolean;
  readonly loginAt: string;
};

export class AdminAccessUserHistoryResponseDto {
  readonly roleRequests: {
    readonly items: readonly RoleRequestHistoryItemResponseDto[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
  readonly loginHistory: {
    readonly items: readonly LoginHistoryItemResponseDto[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };

  private constructor(history: AdminAccessUserHistory) {
    this.roleRequests = {
      ...history.roleRequests,
      items: history.roleRequests.items.map((item) => ({
        ...item,
        decidedAt: item.decidedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
    };
    this.loginHistory = {
      ...history.loginHistory,
      items: history.loginHistory.items.map((item) => ({
        ...item,
        loginAt: item.loginAt.toISOString(),
      })),
    };
  }

  static from(
    history: AdminAccessUserHistory,
  ): AdminAccessUserHistoryResponseDto {
    return new AdminAccessUserHistoryResponseDto(history);
  }
}
