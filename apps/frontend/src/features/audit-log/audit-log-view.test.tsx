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

  it('좁은 화면에서 설명의 한국어 어절 단위 줄바꿈을 유지한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain(
      '<span class="break-keep">역할 요청 변경 이력을 행위자, 액션, 기간으로 조회합니다.</span>',
    );
  });

  it('조회 실패와 44px 다시 시도 버튼을 표시한다', () => {
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
    expect(html).toContain('min-h-11');
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

  it('좁은 화면에서 필터 컨트롤이 폼 안에 유지되고 44px 터치 영역을 제공한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    for (const id of [
      'audit-actor',
      'audit-action',
      'audit-from',
      'audit-to',
    ]) {
      const control = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`));
      const className = control?.[0].match(/class="([^"]+)"/)?.[1];

      expect(className).toContain('min-h-11');
      expect(className).toContain('min-w-0');
      expect(className).toContain('w-full');
    }

    expect(html.match(/<button[^>]+class="[^"]*min-h-11/g)).toHaveLength(2);
  });

  it('공유 Table의 단일 스크롤 영역과 항상 보이는 스크롤 안내를 사용한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html.match(/overflow-x-auto/g)).toHaveLength(1);
    expect(html).toContain('aria-describedby="audit-table-scroll-hint"');
    expect(html).not.toContain('sm:hidden');
    expect(html).not.toContain('min-w-[44rem]');
  });
});
