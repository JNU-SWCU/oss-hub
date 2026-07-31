import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AdminAccessDetail, AdminAccessHistory } from './admin-access-api';
import {
  AdminAccessDetailContentForState,
  type AdminAccessDetailMutationController,
} from './components/admin-access-detail-view';

const noOp = () => undefined;

function mutation(
  overrides: Partial<AdminAccessDetailMutationController> = {},
): AdminAccessDetailMutationController {
  return {
    confirmAction: null,
    processingAction: null,
    rejectReason: '',
    dialogError: null,
    conflictNotice: null,
    successMessage: null,
    onRequestAction: noOp,
    onCancel: noOp,
    onConfirm: noOp,
    onReasonChange: noOp,
    ...overrides,
  };
}

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
        mutation={mutation()}
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
        mutation={mutation()}
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
        mutation={mutation()}
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
        mutation={mutation()}
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
        mutation={mutation()}
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
        mutation={mutation()}
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
        mutation={mutation()}
      />,
    );

    expect(html).toContain('관리자 접근 상세를 불러오지 못했습니다');
    expect(html).toContain('다시 시도');
  });
});

describe('AdminAccessDetailContentForState — 접근 변경 UI (PR04G)', () => {
  it('대기 중인 요청이 있으면 승인/반려 버튼을 노출한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({
            pendingRequest: {
              id: 'req-1',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          }),
          history: history(),
        }}
        onRetry={noOp}
        mutation={mutation()}
      />,
    );

    expect(html).toContain('요청 승인');
    expect(html).toContain('요청 반려');
    expect(html).not.toContain('권한 직접 부여');
  });

  it('대기 중인 요청이 없으면 부여/회수/비활성화 버튼을 노출하고 승인/반려는 숨긴다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={noOp}
        mutation={mutation()}
      />,
    );

    expect(html).toContain('권한 직접 부여');
    expect(html).toContain('권한 회수');
    expect(html).toContain('계정 비활성화');
    expect(html).not.toContain('요청 승인');
    expect(html).not.toContain('요청 반려');
  });

  it('비활성 계정이면 재활성화 버튼만 노출하고 비활성화 버튼은 숨긴다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ accountStatus: 'DEACTIVATED' }),
          history: history(),
        }}
        onRetry={noOp}
        mutation={mutation()}
      />,
    );

    expect(html).toContain('계정 재활성화');
    expect(html).not.toContain('계정 비활성화');
  });

  it('REJECT 확인 액션이면 반려 사유 다이얼로그를 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({
            pendingRequest: {
              id: 'req-1',
              status: 'PENDING',
              createdAt: '2026-07-30T00:00:00.000Z',
            },
          }),
          history: history(),
        }}
        onRetry={noOp}
        mutation={mutation({ confirmAction: 'REJECT' })}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('요청 반려');
    expect(html).toContain('거절 사유');
    expect(html).toContain('synthetic-target');
  });

  it('DEACTIVATE 확인 액션이면 대상 사용자명을 담은 확인 다이얼로그를 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={noOp}
        mutation={mutation({ confirmAction: 'DEACTIVATE' })}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('계정 비활성화');
    expect(html).toContain('synthetic-target');
    expect(html).toContain('비활성화 확정');
  });

  it('다이얼로그 오류 메시지가 있으면 그대로 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={noOp}
        mutation={mutation({
          confirmAction: 'DEACTIVATE',
          dialogError: '관리자는 자신의 계정을 비활성화할 수 없습니다.',
        })}
      />,
    );

    expect(html).toContain('관리자는 자신의 계정을 비활성화할 수 없습니다.');
  });

  it('충돌 안내가 있으면 배너로 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={noOp}
        mutation={mutation({
          conflictNotice: '다른 관리자가 먼저 변경했습니다.',
        })}
      />,
    );

    expect(html).toContain('다른 관리자가 먼저 변경했습니다.');
  });

  it('성공 메시지가 있으면 상태 배너로 렌더링한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={noOp}
        mutation={mutation({
          successMessage:
            'synthetic-target님에 대한 요청 승인 처리를 완료했습니다.',
        })}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain(
      'synthetic-target님에 대한 요청 승인 처리를 완료했습니다.',
    );
  });
});

describe('AdminAccessDetailContentForState — layoutContext (PR04F follow-up: Inspector 1280px 크래시 수정)', () => {
  function layoutClass(html: string): string | undefined {
    return html.match(
      /data-slot="detail-panel-layout"[^>]*class="([^"]*)"/,
    )?.[1];
  }

  it('layoutContext를 생략하면 standalone과 동일하게 md: 2열 분할을 유지한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={noOp}
        mutation={mutation()}
      />,
    );

    expect(layoutClass(html)).toMatch(
      /\bmd:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/,
    );
  });

  it("layoutContext='standalone'이면 md: 2열 분할을 유지한다(표준 페이지는 시각적으로 불변)", () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={noOp}
        mutation={mutation()}
        layoutContext="standalone"
      />,
    );

    expect(layoutClass(html)).toMatch(
      /\bmd:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/,
    );
  });

  it("layoutContext='overlay'면 md: 2열 분할을 꺼서 뷰포트와 무관하게 보조 카드를 본문 아래로 쌓는다", () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={noOp}
        mutation={mutation()}
        layoutContext="overlay"
      />,
    );

    expect(layoutClass(html)).not.toMatch(/md:grid-cols-/);
  });
});
