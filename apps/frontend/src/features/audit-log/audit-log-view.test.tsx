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

  it('행마다 서술문·발생 일시·상대 시각을 표시한다', () => {
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
            target: 'synthetic-target',
            occurredAt: '2026-07-24T03:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    // 서술문: 행위자·대상이 강조되고, target이 GitHub 로그인 형태라 '@' 접두가 붙는다.
    expect(html).toContain('synthetic-admin');
    expect(html).toContain('@synthetic-target');
    expect(html).toContain('님의 교직원 권한 요청을 승인했습니다');
    // 2행: action 배지 + 한국어 targetType + targetId(코드체).
    expect(html).toContain('data-variant="approved"');
    expect(html).toContain('승인');
    expect(html).toContain('권한 요청');
    expect(html).toContain('request-1');
    // 발생 일시: 절대 시각은 항상 표시하고 <time dateTime>을 유지한다.
    expect(html).toContain('<time dateTime="2026-07-24T03:00:00.000Z"');
  });

  it('target이 legacy 폴백 라벨이면 서술문에서 코드체로 표시하고 @를 붙이지 않는다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-legacy',
            actor: 'synthetic-admin',
            action: 'STAFF_ROLE_REQUEST_APPROVED',
            targetType: 'ROLE_REQUEST',
            targetId: 'request-legacy',
            target: 'ROLE_REQUEST / request-legacy',
            occurredAt: '2026-07-24T03:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('<code');
    expect(html).toContain('ROLE_REQUEST / request-legacy');
    expect(html).not.toContain('@ROLE_REQUEST / request-legacy');
  });

  it('REPOSITORY_PUBLISHED 행도 서술문과 targetType 한국어 라벨로 표시한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-repository-published',
            actor: 'synthetic-staff',
            action: 'REPOSITORY_PUBLISHED',
            targetType: 'REPOSITORY',
            targetId: 'repository-synthetic-1',
            target: 'REPOSITORY / repository-synthetic-1',
            occurredAt: '2026-07-24T04:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('저장소');
    expect(html).toContain('공개로 전환했습니다');
    expect(html).toContain('REPOSITORY / repository-synthetic-1');
    expect(html).toContain('repository-synthetic-1');
  });

  it('알 수 없는 action도 원본 값을 담은 폴백 문장으로 숨기지 않고 보여준다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[
          {
            id: 'audit-unknown',
            actor: 'synthetic-admin',
            action: 'LEGACY_SYNTHETIC_ACTION',
            targetType: 'ROLE_REQUEST',
            targetId: 'request-1',
            target: 'synthetic-target',
            occurredAt: '2026-07-24T03:00:00.000Z',
          },
        ]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('기타 작업');
    expect(html).toContain('LEGACY_SYNTHETIC_ACTION');
    expect(html).toContain('작업을 수행했습니다');
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

  it('백엔드 action registry 전체(REPOSITORY_PUBLISHED 포함)를 필터의 API 값과 한국어 표시 이름으로 제공한다', () => {
    for (const [value, label] of [
      ['', '전체'],
      ['STAFF_ROLE_REQUEST_APPROVED', '승인'],
      ['STAFF_ROLE_REQUEST_REJECTED', '반려'],
      ['STAFF_ROLE_REQUEST_REVOKED', '회수'],
      ['STAFF_ROLE_REQUEST_RESTORED', '복구'],
      ['USER_ROLE_CHANGED', '역할 변경'],
      ['USER_ACCOUNT_STATUS_CHANGED', '계정 상태 변경'],
      ['REPOSITORY_PUBLISHED', '저장소 공개'],
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
            target: 'synthetic-target',
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

  it('표 스크롤 영역에 접근성 이름을 부여한다', () => {
    const html = renderToStaticMarkup(
      <AuditLogView
        {...baseProps}
        records={[]}
        isLoading={false}
        errorMessage={null}
      />,
    );

    expect(html).toContain('감사 로그 표');
  });
});
