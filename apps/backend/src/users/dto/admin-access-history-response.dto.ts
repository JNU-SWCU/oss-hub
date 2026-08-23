import type { LoginHistoryEvent, StaffAccessRequestStatus } from '@prisma/client';
import type { AdminAccessUserHistory } from '../domain/admin-access';

type StaffAccessRequestHistoryItemResponseDto = {
  readonly id: string;
  readonly status: StaffAccessRequestStatus;
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
  readonly staffAccessRequests: {
    readonly items: readonly StaffAccessRequestHistoryItemResponseDto[];
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
    this.staffAccessRequests = {
      ...history.staffAccessRequests,
      items: history.staffAccessRequests.items.map((item) => ({
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
