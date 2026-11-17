import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuditLogView, type AuditLogViewProps } from './audit-log-view';
import { parseAuditLogPage } from './parser';
import { AUDIT_LOG_PAGE_RESPONSE_FIXTURE } from './fixtures';

const fixture = parseAuditLogPage(AUDIT_LOG_PAGE_RESPONSE_FIXTURE);

const baseProps: AuditLogViewProps = {
  records: fixture.items,
  counts: fixture.counts,
  filters: { q: '', action: '', from: '', to: '' },
  category: '',
  view: 'feed',
  page: 1,
  limit: 20,
  total: fixture.total,
  isLoading: false,
  errorMessage: null,
  now: new Date('2026-11-17T06:00:00.000Z'),
  onFilterChange: vi.fn(),
  onSearch: vi.fn(),
  onReset: vi.fn(),
  onCategoryChange: vi.fn(),
  onViewChange: vi.fn(),
  onPageChange: vi.fn(),
  onRetry: vi.fn(),
};

function render(overrides: Partial<AuditLogViewProps> = {}) {
  return renderToStaticMarkup(<AuditLogView {...baseProps} {...overrides} />);
}

function text(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('AuditLogView', () => {
  it('shows names before GitHub logins for actors and targets', () => {
    const html = text(render());

    expect(html).toContain(
      '김예시 관리자 → 박샘플 회원 유형 변경 학생 → 교직원',
    );
    expect(html).not.toContain('@synthetic-admin');
    expect(html).not.toContain('@synthetic-target');
  });

  it('labels a nameless actor as unknown with the login and a missing actor as the system', () => {
    const html = text(render());

    expect(html).toContain('알 수 없음 @synthetic-nameless 미선택 로그인');
    expect(html).toContain(
      '시스템 → 알 수 없음 @synthetic-seed 관리자 권한 부여',
    );
  });

  it('renders team, document and revision parts in the feed', () => {
    const html = text(render());

    expect(html).toContain(
      '최운영 교직원 → 클라우드 3팀 합성 클라우드 프로그램 신청 승인 검토 중 → 승인',
    );
    expect(html).toContain(
      '클라우드 1팀 중간보고서 합성 클라우드 프로그램 서류 재제출 v2',
    );
  });

  it('groups the feed under day dividers', () => {
    const html = text(render());

    expect(html).toContain('오늘 · 11월 17일 (화)');
    expect(html).toContain('어제 · 11월 16일 (월)');
    expect(html.indexOf('오늘')).toBeLessThan(html.indexOf('어제'));
  });

  it('shows category chips with counts from the response and marks the selection', () => {
    const html = render({ category: 'SUBMISSION' });

    expect(text(html)).toContain(
      '전체 5 권한·계정 1 운영 1 서류 1 로그인 1 시스템 1',
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>서류/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>전체/);
  });

  it('renders the same records as a sortable table in table view', () => {
    const html = render({ view: 'table' });

    for (const header of ['시각', '행위자', '역할', '동작', '대상']) {
      expect(html).toMatch(
        new RegExp(
          `<th[^>]*aria-sort="[a-z]+"[^>]*>\\s*<button[^>]*>${header}`,
        ),
      );
    }
    expect(html).toMatch(
      /<th[^>]*aria-sort="descending"[^>]*>\s*<button[^>]*>시각/,
    );
    expect(html).toContain('변경');
    expect(text(html)).toContain('김예시');
    expect(html).toMatch(/aria-pressed="true"[^>]*>표/);
  });

  it('shows the loading skeleton, empty state and retryable failure', () => {
    expect(render({ isLoading: true })).toContain('감사 로그를 불러오는 중');
    expect(render({ records: [] })).toContain('기록이 없습니다');
    const failed = render({ errorMessage: '감사 로그를 불러오지 못했습니다.' });
    expect(failed).toContain('감사 로그를 불러오지 못했습니다.');
    expect(failed).toContain('다시 시도');
  });
});
