import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuditLogView } from './audit-log-view';

const baseProps = {
  filters: { actor: '', action: '', from: '', to: '' },
  onFilterChange: vi.fn(),
  onSearch: vi.fn(),
  onReset: vi.fn(),
  onRetry: vi.fn(),
};

describe('AuditLogView', () => {
  it('로딩 스켈레톤을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading
        errorMessage={null}
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('감사 로그를 불러오는 중');
  });

  it('기록이 없으면 빈 상태를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('기록이 없습니다');
  });

  it('조회 조건 설명을 제공한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain(
      '역할 요청 변경 이력을 행위자, 액션, 기간으로 조회합니다.',
    );
  });

  it('조회 실패와 다시 시도 동작을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage="감사 로그를 불러오지 못했습니다."
      />,
    );

    expect(html).toContain('감사 로그를 불러오지 못했습니다.');
    expect(html).toContain('다시 시도');
  });

  it('행위자·액션·대상·발생 일시와 모바일 가로 스크롤 안내를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-1',
            actor: 'synthetic-admin',
            action: 'STAFF_ROLE_REQUEST_APPROVED',
            targetType: 'ROLE_REQUEST',
            targetId: 'request-1',
            occurredAt: '2026-07-24T03:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('synthetic-admin');
    expect(html).toContain('STAFF_ROLE_REQUEST_APPROVED');
    expect(html).toContain('ROLE_REQUEST');
    expect(html).toContain('request-1');
    expect(html).toContain('표를 좌우로 스크롤할 수 있습니다');
  });

  it('필터 이름을 각 컨트롤과 연결한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    for (const [label, id] of [
      ['행위자', 'audit-actor'],
      ['액션 종류', 'audit-action'],
      ['시작일', 'audit-from'],
      ['종료일', 'audit-to'],
    ]) {
      expect(html).toContain(`<label for="${id}"`);
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(label);
    }
  });

  it('표를 가로 스크롤 안내와 연결한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('id="audit-table-scroll-hint"');
    expect(html).toContain('aria-describedby="audit-table-scroll-hint"');
    expect(html).toContain('표를 좌우로 스크롤할 수 있습니다');
  });
});
