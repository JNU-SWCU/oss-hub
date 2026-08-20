// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

import type {
  AdminAccessDetail,
  AdminAccessHistory,
  AdminAccessLoginHistoryItem,
  AdminAccessRoleRequestHistoryItem,
} from './admin-access-api';
import type { AdminAccessMutationAction } from './admin-access-mutation-policy';
import {
  AdminAccessDetailContentForState,
  type AdminAccessDetailMutationController,
} from './components/admin-access-detail-view';

/**
 * `/admin/access/users/[userId]` 상세 화면(PR04E)의 순수-렌더 계약을
 * `AdminAccessDetailContentForState`로 검증한다 — 이 컴포넌트는 `state`와
 * `mutation` 컨트롤러를 그대로 받아 그리므로 네트워크 mocking 없이 상태
 * 조합만으로 화면을 재현할 수 있다(`AdminAccessDetailView` 자체의
 * fetch/effect 배선은 `admin-access-overlay.test.tsx`가 다른 각도에서 다룬다).
 *
 * PR04G 재설계로 "자격 상태"·"마지막 로그인" 카드와 접근 변경 드롭다운이
 * 사라지고, 역할/계정 상태 세그먼트 컨트롤 + 대기 요청 결정 카드 +
 * 섹션별 독립 페이지네이션으로 바뀌었다. 이 파일은 그 새 구조를 검증하고,
 * 오버레이 landmark/heading-level/폭 계약(레이아웃 로직 자체는 바뀌지
 * 않았다)은 마지막 describe에서 별도로 확인한다.
 */

function detail(overrides: Partial<AdminAccessDetail> = {}): AdminAccessDetail {
  return {
    id: 'target',
    githubLogin: 'octocat',
    name: '홍길동',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: '2026-07-30T01:00:00.000Z',
    profile: {
      name: '홍길동',
      studentId: '202601',
      department: '인공지능학부',
      isComplete: true,
    },
    ...overrides,
  };
}

function historyPage<T>(
  overrides: {
    items?: readonly T[];
    page?: number;
    limit?: number;
    total?: number;
  } = {},
) {
  return {
    items: overrides.items ?? [],
    page: overrides.page ?? 1,
    limit: overrides.limit ?? 20,
    total: overrides.total ?? overrides.items?.length ?? 0,
  };
}

function history(
  overrides: Partial<AdminAccessHistory> = {},
): AdminAccessHistory {
  return {
    roleRequests: historyPage<AdminAccessRoleRequestHistoryItem>(),
    loginHistory: historyPage<AdminAccessLoginHistoryItem>(),
    ...overrides,
  };
}

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
    onRequestAction: () => {},
    onCancel: () => {},
    onConfirm: () => {},
    onReasonChange: () => {},
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('상태별 기본 렌더링', () => {
  it('로딩 상태는 재시도 버튼 없이 스켈레톤을 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'loading' }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).toContain('animate-pulse');
  });

  it('에러 상태는 재시도 버튼을 그리고 클릭하면 onRetry가 불린다', () => {
    const onRetry = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{ kind: 'error' }}
          onRetry={onRetry}
          mutation={mutation()}
        />,
      );
    });

    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('다시 시도'),
    );
    expect(retryButton).toBeDefined();
    act(() => {
      retryButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('찾을 수 없음 상태는 목록으로 돌아가는 링크를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'not-found' }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).toContain('사용자를 찾을 수 없습니다');
    expect(html).toContain('href="/admin/access"');
  });

  it('가입 신청 찾을 수 없음은 가입 신청 목록으로 돌아간다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'not-found' }}
        onRetry={() => {}}
        mutation={mutation()}
        workspace="queue"
      />,
    );
    expect(html).toContain('href="/dashboard/applicants"');
    expect(html).toContain('가입 신청으로');
    expect(html).not.toContain('href="/admin/access"');
  });
});

describe('머리말 — 이름·GitHub 링크·역할/상태 배지 (중복 제거된 헤더)', () => {
  it('이름(h1)·@githubLogin·GitHub 외부 링크·역할/상태 배지를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );

    expect(html).toContain('홍길동');
    expect(html).toContain('@octocat');
    expect(html).toContain('href="https://github.com/octocat"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('교직원');
    expect(html).toContain('활성');
  });

  it('이름이 없으면 "이름 미등록"을 제목으로 쓴다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ name: null }),
          history: history(),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).toContain('이름 미등록');
  });

  it('역할이 미지정(null)이면 "미지정" 배지를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ role: null }),
          history: history(),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).toContain('미지정');
  });
});

describe('프로필 섹션 — "기본 정보 입력" dt/dd 제거, 미완료 경고로 대체', () => {
  it('이름/학번/학과만 dt/dd로 그리고, 완료 상태면 경고가 없다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );

    expect(html).toContain('학번');
    expect(html).toContain('202601');
    expect(html).toContain('학과');
    expect(html).toContain('인공지능학부');
    expect(html).not.toContain('기본 정보 입력');
    expect(html).not.toContain('프로필 미완성');
  });

  it('프로필이 미완료면 섹션 상단에 경고 문구를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({
            profile: {
              name: null,
              studentId: null,
              department: null,
              isComplete: false,
            },
          }),
          history: history(),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );

    expect(html).toContain('프로필 미완성 — 교직원 승인·부여 불가');
    expect(html).toContain('미등록');
  });
});

describe('"자격 상태"·"마지막 로그인" 카드 제거', () => {
  it('더 이상 자격 상태 카드를 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).not.toContain('자격 상태');
  });

  it('로그인 이력 제목 옆에 마지막 로그인을 다시 쓰지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ lastLoginAt: '2026-07-30T01:00:00.000Z' }),
          history: history(),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).toContain('로그인 이력');
    expect(html).not.toContain('마지막 로그인');
    expect(html).not.toContain('기록 없음');
  });
});

describe('요청/로그인 이력 — 항목 렌더링과 독립 페이지네이션(total 기반, 잘림 문구 제거)', () => {
  it('역할 요청 항목이 없으면 안내 문구를 보여준다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).toContain('역할 요청 이력이 없습니다.');
    expect(html).toContain('로그인 이력이 없습니다.');
  });

  it('요청/로그인 이력 항목을 상태 배지와 함께 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail(),
          history: history({
            roleRequests: historyPage({
              items: [
                {
                  id: 'req-1',
                  status: 'REJECTED',
                  rejectionReason: '자격 요건 미충족',
                  decidedAt: '2026-07-29T00:00:00.000Z',
                  decidedBy: 'reviewer',
                  createdAt: '2026-07-28T00:00:00.000Z',
                },
              ],
            }),
            loginHistory: historyPage({
              items: [
                {
                  id: 'login-1',
                  event: 'LOGOUT',
                  provider: 'github',
                  success: false,
                  loginAt: '2026-07-30T00:00:00.000Z',
                },
              ],
            }),
          }),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );

    expect(html).toContain('반려');
    expect(html).toContain('자격 요건 미충족');
    expect(html).toContain('reviewer');
    expect(html).toContain('로그아웃');
    expect(html).toContain('실패');
  });

  it('더 이상 "최근 N건만 표시합니다" 잘림 문구를 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail(),
          history: history({
            roleRequests: historyPage({ total: 50 }),
          }),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).not.toContain('만 표시합니다');
  });

  it('total로 페이지 수를 계산해 "n / m 페이지"를 표시한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail(),
          history: history({
            roleRequests: historyPage({ page: 1, limit: 20, total: 25 }),
          }),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).toContain('1 / 2 페이지');
  });

  it('1페이지에서는 "이전" 버튼이 비활성화된다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail(),
          history: history({
            roleRequests: historyPage({ page: 1, limit: 20, total: 25 }),
          }),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    const prevIndex = html.indexOf('이전');
    const disabledBefore = html.slice(Math.max(0, prevIndex - 60), prevIndex);
    expect(disabledBefore).toContain('disabled');
  });

  it('마지막 페이지에서는 "다음" 버튼이 비활성화된다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail(),
          history: history({
            roleRequests: historyPage({ page: 2, limit: 20, total: 25 }),
          }),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).toContain('2 / 2 페이지');
    const nextIndex = html.indexOf('다음');
    const disabledBefore = html.slice(Math.max(0, nextIndex - 60), nextIndex);
    expect(disabledBefore).toContain('disabled');
  });

  it('historyLoading이 켜지면 두 섹션의 이전/다음 버튼이 모두 비활성화된다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail(),
          history: history({
            roleRequests: historyPage({ page: 2, limit: 20, total: 60 }),
            loginHistory: historyPage({ page: 2, limit: 20, total: 60 }),
          }),
        }}
        onRetry={() => {}}
        mutation={mutation()}
        historyLoading
      />,
    );
    const disabledCount = html.match(/disabled=""/g)?.length ?? 0;
    // 이력 섹션 두 곳 각각 이전/다음 2개씩 = 4개.
    expect(disabledCount).toBeGreaterThanOrEqual(4);
  });

  it('"다음" 버튼 클릭은 onRoleRequestPageChange/onLoginHistoryPageChange를 다음 페이지 번호로 호출한다', () => {
    const onRoleRequestPageChange = vi.fn();
    const onLoginHistoryPageChange = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{
            kind: 'ready',
            detail: detail(),
            history: history({
              roleRequests: historyPage({ page: 1, limit: 20, total: 40 }),
              loginHistory: historyPage({ page: 1, limit: 20, total: 40 }),
            }),
          }}
          onRetry={() => {}}
          mutation={mutation()}
          onRoleRequestPageChange={onRoleRequestPageChange}
          onLoginHistoryPageChange={onLoginHistoryPageChange}
        />,
      );
    });

    const nextButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent === '다음',
    );
    expect(nextButtons).toHaveLength(2);

    act(() => {
      nextButtons[0].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onRoleRequestPageChange).toHaveBeenCalledWith(2);

    act(() => {
      nextButtons[1].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onLoginHistoryPageChange).toHaveBeenCalledWith(2);
  });
});

describe('대기 중인 요청 결정 카드 — 접근 변경 카드 위에 조건부로 뜬다', () => {
  it('대기 요청이 없으면 결정 카드를 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ pendingRequest: null }),
          history: history(),
        }}
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).not.toContain('대기 중인 요청');
  });

  it('대기 요청이 있으면 결정 카드와 접근 변경 컨트롤을 함께 그린다', () => {
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
        onRetry={() => {}}
        mutation={mutation()}
      />,
    );
    expect(html).toContain('대기 중인 요청');
    expect(html).toContain('신청됨');
    expect(html).toContain('대기 중인 요청을 먼저 처리해 주세요.');
  });

  it('가입 신청 상세는 승인·반려만 두고 역할 변경 컨트롤은 숨긴다', () => {
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
        onRetry={() => {}}
        mutation={mutation()}
        workspace="queue"
      />,
    );
    expect(html).toContain('대기 중인 요청');
    expect(html).not.toContain('접근 변경');
    expect(html).not.toContain('>수정<');
  });

  it('결정 카드의 승인 버튼 클릭은 mutation.onRequestAction을 APPROVE로 호출한다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
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
          onRetry={() => {}}
          mutation={mutation({ onRequestAction })}
        />,
      );
    });

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '승인',
    );
    act(() => {
      approveButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onRequestAction).toHaveBeenCalledWith('APPROVE');
  });
});

describe('접근 변경 세그먼트 컨트롤 통합 — 클릭이 mutation.onRequestAction까지 이어진다', () => {
  it('다른 역할 버튼 클릭이 SET_ROLE_* 액션으로 전달된다', () => {
    const onRequestAction = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{
            kind: 'ready',
            detail: detail({ role: 'STUDENT' }),
            history: history(),
          }}
          onRetry={() => {}}
          mutation={mutation({ onRequestAction })}
        />,
      );
    });

    const staffButton = Array.from(
      container.querySelectorAll('button[role="radio"]'),
    ).find((button) => button.textContent?.includes('교직원'));
    act(() => {
      staffButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onRequestAction).toHaveBeenCalledWith('SET_ROLE_STAFF');
  });
});

describe('역할/계정 상태 확인 다이얼로그 — 새 액션 이름(SET_ROLE_*/SET_STATUS_*)으로 뜬다', () => {
  it('SET_STATUS_DEACTIVATED는 "계정 비활성화" 다이얼로그를 destructive로 띄운다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ accountStatus: 'ACTIVE' }),
          history: history(),
        }}
        onRetry={() => {}}
        mutation={mutation({
          confirmAction: 'SET_STATUS_DEACTIVATED' as AdminAccessMutationAction,
        })}
      />,
    );
    expect(html).toContain('계정 비활성화');
    expect(html).toContain('octocat님의 계정을 비활성화합니다.');
    expect(html).toContain('비활성화 확정');
  });

  it('SET_STATUS_ACTIVE는 "계정 재활성화" 다이얼로그를 non-destructive로 띄운다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{
          kind: 'ready',
          detail: detail({ accountStatus: 'DEACTIVATED' }),
          history: history(),
        }}
        onRetry={() => {}}
        mutation={mutation({
          confirmAction: 'SET_STATUS_ACTIVE' as AdminAccessMutationAction,
        })}
      />,
    );
    expect(html).toContain('계정 재활성화');
    expect(html).toContain('재활성화 확정');
  });

  it('APPROVE는 승인 확정 다이얼로그를 띄운다', () => {
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
        onRetry={() => {}}
        mutation={mutation({
          confirmAction: 'APPROVE' as AdminAccessMutationAction,
        })}
      />,
    );
    expect(html).toContain('요청 승인');
    expect(html).toContain('승인 확정');
  });

  it('다이얼로그의 취소 버튼은 mutation.onCancel을, 확정 버튼은 mutation.onConfirm을 호출한다', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    act(() => {
      root.render(
        <AdminAccessDetailContentForState
          state={{ kind: 'ready', detail: detail(), history: history() }}
          onRetry={() => {}}
          mutation={mutation({
            confirmAction:
              'SET_STATUS_DEACTIVATED' as AdminAccessMutationAction,
            onCancel,
            onConfirm,
          })}
        />,
      );
    });

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '취소',
    );
    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '비활성화 확정',
    );
    act(() => {
      cancelButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => {
      confirmButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('반려 다이얼로그 — REJECT 액션에서만 뜨는 사유 입력형 (변경 없음)', () => {
  it('confirmAction이 REJECT면 사유 입력란과 반려 확정 버튼을 그린다', () => {
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
        onRetry={() => {}}
        mutation={mutation({ confirmAction: 'REJECT' })}
      />,
    );
    expect(html).toContain('요청 반려');
    expect(html).toContain('거절 사유');
    expect(html).toContain('반려 확정');
  });

  it('사유가 비어 있으면 반려 확정 버튼이 비활성화된다', () => {
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
        onRetry={() => {}}
        mutation={mutation({ confirmAction: 'REJECT', rejectReason: '' })}
      />,
    );
    const confirmIndex = html.indexOf('반려 확정');
    const before = html.slice(Math.max(0, confirmIndex - 200), confirmIndex);
    expect(before).toContain('disabled');
  });
});

describe('배너 — 충돌 알림·성공 메시지·다이얼로그 에러 (로직 변경 없음)', () => {
  it('conflictNotice가 있으면 CAS 충돌 안내를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation({
          conflictNotice: '다른 처리자가 먼저 변경했습니다.',
        })}
      />,
    );
    expect(html).toContain('접근 상태가 변경되었습니다');
    expect(html).toContain('다른 처리자가 먼저 변경했습니다.');
  });

  it('successMessage가 있으면 상태 배너로 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation({
          successMessage: 'octocat님에 대한 계정 비활성화 처리를 완료했습니다.',
        })}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain(
      'octocat님에 대한 계정 비활성화 처리를 완료했습니다.',
    );
  });

  it('dialogError가 있으면 열려 있는 다이얼로그 안에 에러를 그린다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation({
          confirmAction: 'SET_STATUS_DEACTIVATED' as AdminAccessMutationAction,
          dialogError: '활성 관리자 계정을 최소 한 개 유지해야 합니다.',
        })}
      />,
    );
    expect(html).toContain('활성 관리자 계정을 최소 한 개 유지해야 합니다.');
  });
});

describe('레이아웃 컨텍스트(standalone/overlay) — landmark·제목 레벨·448px 오버레이 폭 계약', () => {
  it('standalone은 <main> landmark와 이름 접근 가능한 이름을 갖는다(로딩 상태)', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'loading' }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('<main');
    expect(html).toContain('aria-label="관리자 접근 상세를 불러오는 중"');
  });

  it('overlay는 <main>이 아닌 <div>를 쓰고 landmark 이름을 붙이지 않는다(로딩 상태)', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'loading' }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).not.toContain('<main');
    expect(html).not.toContain('aria-label="관리자 접근 상세를 불러오는 중"');
  });

  it('standalone은 제목 h1 + 섹션 h2를 쓴다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('<h1');
    expect(html).toContain('id="admin-access-profile"');
    expect(html.match(/<h2[^>]*id="admin-access-profile"/)).not.toBeNull();
  });

  it('overlay는 제목 h2 + 섹션 h3를 써서 제목 레벨 역행을 피한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).not.toContain('<h1');
    expect(html.match(/<h3[^>]*id="admin-access-profile"/)).not.toBeNull();
    expect(
      html.match(/<h3[^>]*id="admin-access-role-request-history"/),
    ).not.toBeNull();
    expect(
      html.match(/<h3[^>]*id="admin-access-login-history"/),
    ).not.toBeNull();
  });

  it('overlay는 DetailPanelLayout의 md: 2열 분할을 끄고(stacked) 항상 세로로 쌓는다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).not.toContain('md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]');
  });

  it('overlay는 접근 변경을 이력보다 앞에 두고 이력 라벨로 구분한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="overlay"
      />,
    );
    const accessChangeAt = html.indexOf('접근 변경');
    const historyLabelAt = html.indexOf('>이력</');
    const loginHistoryAt = html.indexOf('로그인 이력');
    expect(accessChangeAt).toBeGreaterThan(-1);
    expect(historyLabelAt).toBeGreaterThan(accessChangeAt);
    expect(loginHistoryAt).toBeGreaterThan(historyLabelAt);
  });

  it('standalone 왼쪽은 이력, 오른쪽은 편집이다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="standalone"
      />,
    );
    const primary =
      html.match(
        /data-slot="detail-panel-primary"[^>]*>([\s\S]*?)data-slot="detail-panel-secondary"/,
      )?.[1] ?? '';
    const secondary =
      html.match(/data-slot="detail-panel-secondary"[^>]*>([\s\S]*)$/)?.[1] ??
      '';
    expect(primary).toContain('로그인 이력');
    expect(primary).not.toContain('접근 변경');
    expect(secondary).toContain('접근 변경');
  });

  it('standalone은 DetailPanelLayout을 2열로 유지한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]');
  });

  it('overlay는 뷰포트 기준 sm: 계단 대신 고정 폭 전용 클래스를 쓴다(448px 컨테이너 대응)', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).toContain('min-w-0');
    expect(html).not.toContain('max-w-6xl');
    expect(html).toContain('sm:justify-start');
    expect(html).toContain('sm:text-section');
  });

  it('standalone은 뷰포트 폭 전체를 쓰는 계단식 클래스를 쓴다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('max-w-6xl');
    expect(html).not.toContain('sm:justify-start');
  });

  it('overlay는 프로필 dl을 sm:grid-cols-1로 강제해 좁은 렌더 폭에서 눌리지 않게 한다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="overlay"
      />,
    );
    expect(html).toContain('sm:grid-cols-1');
  });

  it('standalone은 프로필 dl을 기본 sm:grid-cols-2로 둔다', () => {
    const html = renderToStaticMarkup(
      <AdminAccessDetailContentForState
        state={{ kind: 'ready', detail: detail(), history: history() }}
        onRetry={() => {}}
        mutation={mutation()}
        layoutContext="standalone"
      />,
    );
    expect(html).toContain('sm:grid-cols-2');
  });
});
