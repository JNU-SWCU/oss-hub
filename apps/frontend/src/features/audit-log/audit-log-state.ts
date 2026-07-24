import type { AuditLogFilters } from './types';

const EMPTY_FILTERS: AuditLogFilters = {
  actor: '',
  action: '',
  from: '',
  to: '',
};

export interface AuditLogFilterState {
  readonly draftFilters: AuditLogFilters;
  readonly appliedFilters: AuditLogFilters;
}

type AuditLogFilterAction =
  | { readonly type: 'edit'; readonly filters: AuditLogFilters }
  | { readonly type: 'search' }
  | { readonly type: 'reset' };

export const initialAuditLogState: AuditLogFilterState = {
  draftFilters: EMPTY_FILTERS,
  appliedFilters: EMPTY_FILTERS,
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
  const appliedFilters = {
    ...state.draftFilters,
    actor: state.draftFilters.actor.trim(),
  };
  return { draftFilters: appliedFilters, appliedFilters };
}

export function retryAuditLogFilters(
  state: AuditLogFilterState,
): AuditLogFilters {
  return state.appliedFilters;
}
