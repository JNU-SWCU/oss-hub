import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AdminAccessDetail, AdminAccessHistory } from './admin-access-api';
import { AdminAccessDetailContentForState } from './components/admin-access-detail-view';

const noOp = () => undefined;

function detail(overrides: Partial<AdminAccessDetail> = {}): AdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: '2026-07-30T01:00:00.000Z',
    profile: {
      name: '합성 사용자',
      studentId: '202601',
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

function history(
  overrides: Partial<AdminAccessHistory> = {},
): AdminAccessHistory {
  return {
    roleRequests: {
      items: [
        {
          id: 'request-1',
          status: 'REJECTED',
          rejectionReason: '담당 프로그램 소속 확인 불가',
          decidedAt: '2026-07-20T00:00:00.000Z',
          decidedBy: '합성 관리자',
          createdAt: '2026-07-19T00:00:00.000Z',
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    },
    loginHistory: {
      items: [
        {
          id: 'login-1',
          event: 'LOGIN',
          provider: 'github',
          success: true,
          loginAt: '2026-07-30T01:00:00.000Z',
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    },
    ...overrides,
  };
}

describe('AdminAccessDetailContentForState — 표준 접근 상세 화면 상태', () => {
  it('로딩 중에는 로딩 영역만 표시하고 프로필 데이터를 렌더링하지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'loading' }}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('관리자 접근 상세를 불러오는 중');
    expect(html).not.toContain('합성 사용자');
  });

  it('populated 상태는 프로필·요청/로그인 이력·마지막 로그인·자격 상태를 모두 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('합성 사용자');
    expect(html).toContain('@synthetic-target');
    expect(html).toContain('202601');
    expect(html).toContain('인공지능학부');
    expect(html).toContain('요청 이력');
    expect(html).toContain('담당 프로그램 소속 확인 불가');
    expect(html).toContain('로그인 이력');
    expect(html).toContain('자격 상태');
    expect(html).toContain('자격 있음');
    expect(html).toContain('마지막 로그인');
  });

  it('계정이 비활성화되면 자격 없음과 차단 사유를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ accountStatus: 'DEACTIVATED' }),
          history: history(),
        }}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('자격 없음');
    expect(html).toContain('계정이 비활성화되어 있습니다.');
  });

  it('요청/로그인 이력이 한도만큼 잘리면 안내 문구를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail(),
          history: history({
            roleRequests: {
              items: history().roleRequests.items,
              page: 1,
              limit: 20,
              total: 25,
            },
          }),
        }}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('최근 1건만 표시합니다.');
  });

  it('요청/로그인 이력이 없으면 빈 이력 안내를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail(),
          history: history({
            roleRequests: { items: [], page: 1, limit: 20, total: 0 },
            loginHistory: { items: [], page: 1, limit: 20, total: 0 },
          }),
        }}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('역할 요청 이력이 없습니다.');
    expect(html).toContain('로그인 이력이 없습니다.');
  });

  it('not-found 상태는 사용자를 찾을 수 없다는 안내와 목록 복귀 링크를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'not-found' }}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('사용자를 찾을 수 없습니다');
    expect(html).toContain('href="/admin/access"');
  });

  it('error 상태는 오류 메시지와 다시 시도 버튼을 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'error' }}
        onRetry={noOp}
      />,
    );

    expect(html).toContain('관리자 접근 상세를 불러오지 못했습니다');
    expect(html).toContain('다시 시도');
  });
});
