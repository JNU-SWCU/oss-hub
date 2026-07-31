import type { AuditLogFilters, AuditLogListParams } from './types';

const EMPTY_FILTERS: AuditLogFilters = {
  actor: '',
  action: '',
  from: '',
  to: '',
};

export const AUDIT_LOG_PAGE_LIMIT = 20;

export interface AuditLogFilterState {
  readonly draftFilters: AuditLogFilters;
  readonly appliedFilters: AuditLogFilters;
  readonly page: number;
}

type AuditLogFilterAction =
  | { readonly type: 'edit'; readonly filters: AuditLogFilters }
  | { readonly type: 'search' }
  | { readonly type: 'reset' }
  | { readonly type: 'page'; readonly page: number };

export const initialAuditLogState: AuditLogFilterState = {
  draftFilters: EMPTY_FILTERS,
  appliedFilters: EMPTY_FILTERS,
  page: 1,
};

export function auditLogStateReducer(
  state: AuditLogFilterState,
  action: AuditLogFilterAction,
): AuditLogFilterState {
  if (action.type === 'edit') {
    return { ...state, draftFilters: action.filters };
  }
  if (action.type === 'reset') {
    return initialAuditLogState;
  }
  if (action.type === 'page') {
    return { ...state, page: action.page };
  }
  const appliedFilters = {
    ...state.draftFilters,
    actor: state.draftFilters.actor.trim(),
  };
  return { draftFilters: appliedFilters, appliedFilters, page: 1 };
}

export function auditLogQueryParams(
  state: AuditLogFilterState,
): AuditLogListParams {
  return {
    ...state.appliedFilters,
    page: state.page,
    limit: AUDIT_LOG_PAGE_LIMIT,
  };
}
