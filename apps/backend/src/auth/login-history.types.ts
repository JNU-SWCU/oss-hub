export const LOGIN_HISTORY_EVENTS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
} as const;

export type LoginHistoryEvent =
  (typeof LOGIN_HISTORY_EVENTS)[keyof typeof LOGIN_HISTORY_EVENTS];

export const LOGIN_HISTORY_PROVIDER = 'github' as const;

export type LoginHistory = {
  readonly id: string;
  readonly event: LoginHistoryEvent;
  readonly provider: typeof LOGIN_HISTORY_PROVIDER;
  readonly success: boolean;
  readonly loginAt: Date;
};

export type LoginHistoryPage = {
  readonly items: readonly LoginHistory[];
  readonly page: number;
  readonly size: number;
  readonly total: number;
};
