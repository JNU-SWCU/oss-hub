import type {
  LoginHistoryEvent,
  StaffAccessRequestStatus,
} from '@prisma/client';
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

type StaffAccessRequestPageResponseDto = {
  readonly items: readonly StaffAccessRequestHistoryItemResponseDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
};

export class AdminAccessUserHistoryResponseDto {
  readonly staffAccessRequests: StaffAccessRequestPageResponseDto;
  /**
   * 정본 `staffAccessRequests`의 **bridge 전용 legacy 별칭**. 같은 객체를 가리킨다.
   *
   * 직전 프런트엔드 번들(v0.6.110)의 `parseAdminAccessHistory`는 응답을 런타임에
   * 검증해서 `roleRequests`가 없으면 `AdminAccessResponseError`를 던진다 — 백엔드를
   * 먼저 교체하는 동안 그 번들이 살아 있으므로 두 철자를 함께 싫는다.
   *
   * **같은 참조를 넣는 것이 중요하다.** 따로 만들어 넣으면 두 철자가 서로 다른
   * sanitize를 거치게 되고, 한쪽만 원본을 노출하는 사고가 조용히 생긴다.
   *
   * 다음 contract PR이 직전 번들이 사라진 뒤 이 칸을 걷어낸다.
   */
  readonly roleRequests: StaffAccessRequestPageResponseDto;
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
    // sanitize는 위에서 끝났다. 여기서는 **그 결과를 그대로 가리킨다**.
    this.roleRequests = this.staffAccessRequests;
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
