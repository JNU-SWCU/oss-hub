import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  parseListEnum,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import {
  AUDIT_LOG_ACTIONS,
  AUDIT_LOG_CATEGORIES,
  AUDIT_LOG_PERIODS,
  AUDIT_LOG_VIEWS,
  type AuditLogCategory,
  type AuditLogFilters,
  type AuditLogViewMode,
} from './types';

export interface AuditLogUrlState extends AuditLogFilters {
  readonly category: AuditLogCategory | '';
  readonly view: AuditLogViewMode;
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
  const from = parseDate(params.get('from'));
  const to = parseDate(params.get('to'));
  const period = parseListEnum(
    params.get('period'),
    AUDIT_LOG_PERIODS,
    from || to ? 'custom' : '30d',
  );
  return {
    q: params.get('q')?.trim() ?? '',
    action: parseListEnum(params.get('action'), [...AUDIT_LOG_ACTIONS, ''], ''),
    category: parseListEnum(
      params.get('category'),
      [...AUDIT_LOG_CATEGORIES, ''],
      '',
    ),
    period,
    from: period === 'custom' ? from : '',
    to: period === 'custom' ? to : '',
    view: parseListEnum(params.get('view'), AUDIT_LOG_VIEWS, 'feed'),
    page: parseListPage(params.get('page')),
  };
}

export function buildAuditLogSearchParams(state: AuditLogUrlState) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.category) params.set('category', state.category);
  if (state.action) params.set('action', state.action);
  if (state.period !== '30d') params.set('period', state.period);
  if (state.period === 'custom' && state.from) params.set('from', state.from);
  if (state.period === 'custom' && state.to) params.set('to', state.to);
  if (state.view !== 'feed') params.set('view', state.view);
  setListPage(params, state.page);
  return params;
}

const OWNED_PARAMS = [
  'q',
  'category',
  'action',
  'period',
  'from',
  'to',
  'view',
  'page',
] as const;

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
