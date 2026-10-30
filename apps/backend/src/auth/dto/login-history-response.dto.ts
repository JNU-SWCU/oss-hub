import type {
  LoginHistory,
  LoginHistoryEvent,
  LoginHistoryPage,
} from '../http-auth.types';

export class LoginHistoryResponseDto {
  declare readonly id: string;
  declare readonly event: LoginHistoryEvent;
  declare readonly provider: 'github';
  declare readonly success: boolean;
  declare readonly loginAt: string;

  static from(history: LoginHistory): LoginHistoryResponseDto {
    return {
      id: history.id,
      event: history.event,
      provider: history.provider,
      success: history.success,
      loginAt: history.loginAt.toISOString(),
    };
  }
}

export class LoginHistoryPageResponseDto {
  declare readonly items: readonly LoginHistoryResponseDto[];
  declare readonly page: number;
  declare readonly size: number;
  declare readonly total: number;

  static from(historyPage: LoginHistoryPage): LoginHistoryPageResponseDto {
    return {
      items: historyPage.items.map((history) =>
        LoginHistoryResponseDto.from(history),
      ),
      page: historyPage.page,
      size: historyPage.size,
      total: historyPage.total,
    };
  }
}
