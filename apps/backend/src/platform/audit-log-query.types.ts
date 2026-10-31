export type AuditLogListQuery = {
  readonly actor?: string;
  readonly action?: string;
  readonly from?: string;
  readonly to?: string;
  readonly page: number;
  readonly limit: number;
};
