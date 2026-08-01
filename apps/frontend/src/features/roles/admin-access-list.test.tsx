import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_ACCESS_DEFAULT_FILTER_STATE,
  ADMIN_ACCESS_LIST_LIMIT,
  buildAdminAccessListParams,
} from './admin-access-list-query';
import { AdminAccessView } from './components/admin-access-view';
import type { AdminAccessListItem } from './admin-access-api';

const noOp = () => undefined;

function item(
  overrides: Partial<AdminAccessListItem> = {},
): AdminAccessListItem {
  return {
    id: 'synthetic-user',
    githubLogin: 'synthetic-user',
    name: '합성 사용자',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
  };
}

const baseViewProps = {
  items: [item()],
  query: '',
  role: '' as const,
  accountStatus: '' as const,
  pendingRequest: '' as const,
  sort: 'name' as const,
  direction: 'asc' as const,
  page: 1,
  limit: ADMIN_ACCESS_LIST_LIMIT,
  total: 1,
  pendingCount: 0,
  isLoading: false,
  errorMessage: null,
  onQueryChange: noOp,
  onSearch: noOp,
  onRoleChange: noOp,
  onAccountStatusChange: noOp,
  onPendingRequestChange: noOp,
  onSortChange: noOp,
  onDirectionToggle: noOp,
  onPageChange: noOp,
  onRetry: noOp,
  onResetFilters: noOp,
};

describe('buildAdminAccessListParams — 필터/정렬/페이지 상태를 어댑터 query로 변환한다', () => {
  it('기본 상태는 sort/direction/page/limit만 포함하고 빈 필터는 생략한다', () => {
    expect(
      buildAdminAccessListParams(ADMIN_ACCESS_DEFAULT_FILTER_STATE),
    ).toEqual({
      sort: 'name',
      direction: 'asc',
      page: 1,
      limit: ADMIN_ACCESS_LIST_LIMIT,
    });
  });

  it('검색어 필터 상호작용은 앞뒤 공백을 제거해 query에 반영된다', () => {
    expect(
      buildAdminAccessListParams({
        ...ADMIN_ACCESS_DEFAULT_FILTER_STATE,
        query: '  합성 검색어  ',
      }).query,
    ).toBe('합성 검색어');
  });

  it('공백만 있는 검색어는 query를 생략한다', () => {
    expect(
      buildAdminAccessListParams({
        ...ADMIN_ACCESS_DEFAULT_FILTER_STATE,
        query: '   ',
      }),
    ).not.toHaveProperty('query');
  });

  it('역할·계정 상태·요청 대기 필터 상호작용이 모두 params에 반영된다', () => {
    expect(
      buildAdminAccessListParams({
        ...ADMIN_ACCESS_DEFAULT_FILTER_STATE,
        role: 'UNASSIGNED',
        accountStatus: 'DEACTIVATED',
        pendingRequest: 'PENDING',
      }),
    ).toMatchObject({
      role: 'UNASSIGNED',
      accountStatus: 'DEACTIVATED',
      pendingRequest: 'PENDING',
    });
  });

  it('정렬 필드·방향 상호작용이 params에 반영된다', () => {
    expect(
      buildAdminAccessListParams({
        ...ADMIN_ACCESS_DEFAULT_FILTER_STATE,
        sort: 'lastLoginAt',
        direction: 'desc',
      }),
    ).toMatchObject({ sort: 'lastLoginAt', direction: 'desc' });
  });

  it('페이지 이동 상호작용이 page에 반영되고 limit은 고정값을 유지한다', () => {
    expect(
      buildAdminAccessListParams({
        ...ADMIN_ACCESS_DEFAULT_FILTER_STATE,
        page: 3,
      }),
    ).toMatchObject({ page: 3, limit: ADMIN_ACCESS_LIST_LIMIT });
  });
});

describe('AdminAccessView — 읽기 전용 접근 목록 화면', () => {
  it('로딩 중에는 로딩 문구를 표시하고 데이터 행을 렌더링하지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView {...baseViewProps} items={[]} isLoading={true} />,
    );

    expect(html).toContain('접근 목록을 불러오는 중…');
    expect(html).not.toContain('synthetic-user');
  });

  it('이름을 우선 표시하고 GitHub 로그인은 보조로, 미완료 프로필은 명시적으로 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView
        {...baseViewProps}
        items={[
          item({ name: null, isProfileComplete: false, pendingRequest: null }),
        ]}
      />,
    );

    expect(html).toContain('이름 미등록');
    expect(html).toContain('@synthetic-user');
    expect(html).toContain('프로필 미완료');
  });

  it('대기 중인 역할 요청이 있으면 명시적으로 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView
        {...baseViewProps}
        items={[
          item({
            pendingRequest: {
              id: 'synthetic-request',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          }),
        ]}
      />,
    );

    expect(html).toContain('요청 대기');
  });

  it('마지막 로그인 기록이 없으면 기록 없음을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView
        {...baseViewProps}
        items={[item({ lastLoginAt: null })]}
      />,
    );

    expect(html).toContain('기록 없음');
  });

  it('필터·정렬 선택 값과 정렬 방향 토글 라벨이 현재 상태를 반영한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView
        {...baseViewProps}
        role="ADMIN"
        accountStatus="DEACTIVATED"
        pendingRequest="PENDING"
        sort="lastLoginAt"
        direction="desc"
      />,
    );

    expect(html).toContain('data-slot="select-trigger"');
    expect(html).toContain('내림차순');
  });

  it('오름차순 상태에서는 오름차순 토글 라벨을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView {...baseViewProps} direction="asc" />,
    );

    expect(html).toContain('오름차순');
  });

  it('첫 페이지에서는 이전 페이지 이동을 비활성화한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView
        {...baseViewProps}
        page={1}
        total={ADMIN_ACCESS_LIST_LIMIT * 3}
      />,
    );

    const prevButtonIndex = html.indexOf('이전');
    const prevButtonTagStart = html.lastIndexOf('<button', prevButtonIndex);
    expect(html.slice(prevButtonTagStart, prevButtonIndex)).toContain(
      'disabled',
    );
  });

  it('마지막 페이지에서는 다음 페이지 이동을 비활성화하고 총원을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView
        {...baseViewProps}
        page={3}
        total={ADMIN_ACCESS_LIST_LIMIT * 3}
      />,
    );

    const nextButtonIndex = html.indexOf('다음');
    const nextButtonTagStart = html.lastIndexOf('<button', nextButtonIndex);
    expect(html.slice(nextButtonTagStart, nextButtonIndex)).toContain(
      'disabled',
    );
    expect(html).toContain(
      `3 / 3 페이지 (총 ${ADMIN_ACCESS_LIST_LIMIT * 3}명)`,
    );
  });

  it('오류가 있으면 오류 메시지와 다시 시도 버튼을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView
        {...baseViewProps}
        items={[]}
        errorMessage="목록을 불러오지 못했습니다."
      />,
    );

    expect(html).toContain('목록을 불러오지 못했습니다.');
    expect(html).toContain('다시 시도');
  });

  it('요청함 탭은 대기 중인 요청 수를 표시하고, 전체 목록이 기본 활성 상태다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView {...baseViewProps} pendingRequest="" pendingCount={3} />,
    );

    expect(html).toContain('요청함 (3)');
    const allTabIndex = html.indexOf('전체 목록');
    const allTabStart = html.lastIndexOf('<button', allTabIndex);
    expect(html.slice(allTabStart, allTabIndex)).toContain(
      'aria-pressed="true"',
    );
  });

  it('요청함 탭 활성 상태에서는 요청함 버튼이 aria-pressed를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView
        {...baseViewProps}
        pendingRequest="PENDING"
        pendingCount={0}
      />,
    );

    expect(html).toContain('요청함');
    expect(html).not.toContain('요청함 (0)');
    const inboxTabIndex = html.indexOf('요청함');
    const inboxTabStart = html.lastIndexOf('<button', inboxTabIndex);
    expect(html.slice(inboxTabStart, inboxTabIndex)).toContain(
      'aria-pressed="true"',
    );
  });

  it('검색 결과가 없으면 안내와 필터 초기화 동작을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessView {...baseViewProps} items={[]} total={0} query="없음" />,
    );

    expect(html).toContain('검색 결과가 없습니다');
    expect(html).toContain('필터 초기화');
  });
});
