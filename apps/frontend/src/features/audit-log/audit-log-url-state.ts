import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  parseListEnum,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import { AUDIT_LOG_ACTIONS, type AuditLogFilters } from './types';
interface AuditLogUrlState extends AuditLogFilters {
  readonly page: number;
}
function parseDate(raw: string | null) {
  return raw !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw) &&
    Number.isFinite(Date.parse(raw)) &&
    new Date(raw).toISOString().slice(0, 10) === raw
    ? raw
    : '';
}
export function parseAuditLogSearchParams(
  params: URLSearchParams,
): AuditLogUrlState {
  return {
    actor: params.get('actor')?.trim() ?? '',
    action: parseListEnum(params.get('action'), [...AUDIT_LOG_ACTIONS, ''], ''),
    from: parseDate(params.get('from')),
    to: parseDate(params.get('to')),
    page: parseListPage(params.get('page')),
  };
}
export function buildAuditLogSearchParams(state: AuditLogUrlState) {
  const params = new URLSearchParams();
  if (state.actor.trim()) params.set('actor', state.actor.trim());
  if (state.action) params.set('action', state.action);
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  setListPage(params, state.page);
  return params;
}

const OWNED_PARAMS = ['actor', 'action', 'from', 'to', 'page'] as const;

export function useAuditLogUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(serialized, parseAuditLogSearchParams);
  const navigate = useListUrlNavigation(
    state,
    buildAuditLogSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
