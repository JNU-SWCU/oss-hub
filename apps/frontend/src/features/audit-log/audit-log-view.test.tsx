import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuditLogView } from './audit-log-view';

const baseProps = {
  filters: { actor: '', action: '', from: '', to: '' },
  page: 1,
  limit: 20,
  total: 0,
  onFilterChange: vi.fn(),
  onSearch: vi.fn(),
  onReset: vi.fn(),
  onPageChange: vi.fn(),
  onRetry: vi.fn(),
};

function isButtonDisabled(html: string, label: string): boolean {
  const button = html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
  if (button === undefined) {
    throw new Error(`"${label}" 버튼을 찾지 못했습니다.`);
  }
  // shadcn Button의 className에 `disabled:` 변형이 들어 있으므로 속성만 본다.
  return / disabled=""/.test(button);
}

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

  it('액션 필터의 API 값과 한국어 표시 이름을 함께 제공한다', () => {
    for (const [value, label] of [
      ['', '전체'],
      ['STAFF_ROLE_REQUEST_APPROVED', '승인'],
      ['STAFF_ROLE_REQUEST_REJECTED', '반려'],
      ['STAFF_ROLE_REQUEST_REVOKED', '회수'],
    ]) {
      const html = renderToStaticMarkup(
        <AuditLogView
          {...baseProps}
          filters={{ ...baseProps.filters, action: value }}
          records={[]}
          isLoading={false}
          errorMessage={null}
        />,
      );

      expect(html).toContain(
        `<option value="${value}" selected="">${label}</option>`,
      );
    }
  });

  it('전체 건수와 현재 페이지를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        page={2}
        total={45}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('총 45건');
    expect(html).toContain('2 / 3 페이지');
  });

  it('첫 페이지에서는 이전으로, 마지막 페이지에서는 다음으로 넘어갈 수 없다', () => {
    const firstPage = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        page={1}
        total={25}
        isLoading={false}
        errorMessage={null}
      />,
    );
    const lastPage = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        page={2}
        total={25}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(isButtonDisabled(firstPage, '이전')).toBe(true);
    expect(isButtonDisabled(firstPage, '다음')).toBe(false);
    expect(isButtonDisabled(lastPage, '이전')).toBe(false);
    expect(isButtonDisabled(lastPage, '다음')).toBe(true);
  });

  it('결과가 한 페이지에 다 들어가면 양쪽 이동을 모두 막는다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        page={1}
        total={3}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('1 / 1 페이지');
    expect(isButtonDisabled(html, '이전')).toBe(true);
    expect(isButtonDisabled(html, '다음')).toBe(true);
  });

  it('기록이 20건을 넘어도 한 페이지에 담긴 만큼만 표시한다', () => {
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
        page={1}
        total={100}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('총 100건');
    expect(html).toContain('1 / 5 페이지');
    expect(html).toContain('request-1');
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
