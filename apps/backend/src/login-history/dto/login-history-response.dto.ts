import type {
  LoginHistory,
  LoginHistoryEvent,
  LoginHistoryPage,
} from '../domain/login-history';

export class LoginHistoryResponseDto {
  readonly id: string;
  readonly event: LoginHistoryEvent;
  readonly provider: 'github';
  readonly success: boolean;
  readonly loginAt: string;

  private constructor(history: LoginHistory) {
    this.id = history.id;
    this.event = history.event;
    this.provider = history.provider;
    this.success = history.success;
    this.loginAt = history.loginAt.toISOString();
  }

  static from(history: LoginHistory): LoginHistoryResponseDto {
    return new LoginHistoryResponseDto(history);
  }
}

export class LoginHistoryPageResponseDto {
  readonly items: readonly LoginHistoryResponseDto[];
  readonly page: number;
  readonly size: number;
  readonly total: number;

  private constructor(historyPage: LoginHistoryPage) {
    this.items = historyPage.items.map((history) =>
      LoginHistoryResponseDto.from(history),
    );
    this.page = historyPage.page;
    this.size = historyPage.size;
    this.total = historyPage.total;
  }

  static from(historyPage: LoginHistoryPage): LoginHistoryPageResponseDto {
    return new LoginHistoryPageResponseDto(historyPage);
  }
}
