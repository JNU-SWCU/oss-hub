import { describe, expect, it } from 'vitest';
import {
  AUDIT_LOG_PAGE_LIMIT,
  auditLogQueryParams,
  auditLogStateReducer,
  initialAuditLogState,
} from './audit-log-state';

function searchedFor(actor: string) {
  return auditLogStateReducer(
    auditLogStateReducer(initialAuditLogState, {
      type: 'edit',
      filters: { ...initialAuditLogState.draftFilters, actor },
    }),
    { type: 'search' },
  );
}

describe('audit log filter state', () => {
  it('다시 시도는 편집 중인 값이 아니라 마지막 조회 필터를 재사용한다', () => {
    const searched = searchedFor('searched-admin');
    const editingNextQuery = auditLogStateReducer(searched, {
      type: 'edit',
      filters: { ...searched.draftFilters, actor: 'not-searched-yet' },
    });

    expect(auditLogQueryParams(editingNextQuery)).toEqual({
      actor: 'searched-admin',
      action: '',
      from: '',
      to: '',
      page: 1,
      limit: AUDIT_LOG_PAGE_LIMIT,
    });
  });

  it('페이지 이동은 조회 필터를 유지한 채 page만 바꾼다', () => {
    const secondPage = auditLogStateReducer(searchedFor('searched-admin'), {
      type: 'page',
      page: 2,
    });

    expect(auditLogQueryParams(secondPage)).toMatchObject({
      actor: 'searched-admin',
      page: 2,
    });
  });

  it('새 조회는 뒤쪽 페이지에 머무르지 않고 1페이지로 돌아간다', () => {
    const secondPage = auditLogStateReducer(searchedFor('searched-admin'), {
      type: 'page',
      page: 2,
    });
    const researched = auditLogStateReducer(secondPage, { type: 'search' });

    expect(researched.page).toBe(1);
  });

  it('초기화는 페이지까지 되돌린다', () => {
    const secondPage = auditLogStateReducer(searchedFor('searched-admin'), {
      type: 'page',
      page: 2,
    });

    expect(auditLogStateReducer(secondPage, { type: 'reset' })).toEqual(
      initialAuditLogState,
    );
  });

  it('필터 편집만으로는 조회 파라미터가 바뀌지 않는다', () => {
    const searched = searchedFor('searched-admin');
    const edited = auditLogStateReducer(searched, {
      type: 'edit',
      filters: { ...searched.draftFilters, actor: 'typing' },
    });

    expect(edited.appliedFilters).toBe(searched.appliedFilters);
  });
});
