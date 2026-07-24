import { describe, expect, it } from 'vitest';
import {
  auditLogStateReducer,
  initialAuditLogState,
  retryAuditLogFilters,
} from './audit-log-state';

describe('audit log filter state', () => {
  it('다시 시도는 편집 중인 값이 아니라 마지막 조회 필터를 재사용한다', () => {
    const searched = auditLogStateReducer(
      auditLogStateReducer(initialAuditLogState, {
        type: 'edit',
        filters: {
          ...initialAuditLogState.draftFilters,
          actor: 'searched-admin',
        },
      }),
      { type: 'search' },
    );
    const editingNextQuery = auditLogStateReducer(searched, {
      type: 'edit',
      filters: {
        ...searched.draftFilters,
        actor: 'not-searched-yet',
      },
    });

    expect(retryAuditLogFilters(editingNextQuery)).toEqual({
      actor: 'searched-admin',
      action: '',
      from: '',
      to: '',
    });
  });
});
