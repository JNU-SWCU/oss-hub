import { isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';

/**
 * `staff-requests.test.tsx`는 `StaffRequestsView`(순수 표시 컴포넌트)만 정적 렌더로 검증한다.
 * 실제 승인/반려/회수 흐름을 쥐고 있는 `StaffRequestsScreen`(컨테이너)은 어디서도 실행되지 않았다.
 * 이 파일은 `useState`/`useCallback`/`useEffect`만 대체해 실 컨테이너 함수를 직접 호출하고,
 * 낙관적 갱신 롤백과 409 충돌 시 목록 재조회(UI reload)를 실제 실행 경로로 고정한다.
 * (`role-selection-navigation.test.tsx`와 동일한 방식 — jsdom·testing-library 없이 기존 관례를 따른다.)
 */

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  fetchStaffRoleRequests: vi.fn(),
  decideStaffRoleRequest: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: mocks.useState,
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
  };
});

vi.mock('../api', () => ({
  fetchStaffRoleRequests: mocks.fetchStaffRoleRequests,
  decideStaffRoleRequest: mocks.decideStaffRoleRequest,
}));

import { StaffRequestsScreen } from './staff-requests-screen';
import type { StaffRoleRequest } from '../types';

interface ScreenProps {
  readonly onApprove: (request: StaffRoleRequest) => void;
}

const pendingRequest: StaffRoleRequest = {
  id: 'request-1',
  githubLogin: 'synthetic-staff',
  requestedRole: 'STAFF',
  status: 'PENDING',
  requestedAt: '2026-07-01T00:00:00.000Z',
  decidedAt: null,
  decidedBy: null,
  rejectionReason: null,
};

/** 컴포넌트 소스의 `useState` 선언 순서와 반드시 일치해야 한다. */
function stubUseState(setters: {
  readonly setItems: ReturnType<typeof vi.fn>;
  readonly setError: ReturnType<typeof vi.fn>;
  readonly setSuccess: ReturnType<typeof vi.fn>;
  readonly setProcessingIds: ReturnType<typeof vi.fn>;
  readonly setRejectingRequest: ReturnType<typeof vi.fn>;
  readonly setRejectionReason: ReturnType<typeof vi.fn>;
  readonly setRevokingRequest: ReturnType<typeof vi.fn>;
}) {
  mocks.useState
    .mockReturnValueOnce([[pendingRequest], setters.setItems]) // items
    .mockReturnValueOnce(['PENDING', vi.fn()]) // status
    .mockReturnValueOnce(['', vi.fn()]) // queryInput
    .mockReturnValueOnce(['', vi.fn()]) // query
    .mockReturnValueOnce([1, vi.fn()]) // page
    .mockReturnValueOnce([1, vi.fn()]) // total
    .mockReturnValueOnce([false, vi.fn()]) // isLoading
    .mockReturnValueOnce([null, setters.setError]) // error
    .mockReturnValueOnce([null, setters.setSuccess]) // success
    .mockReturnValueOnce([new Set(), setters.setProcessingIds]) // processingIds
    .mockReturnValueOnce([null, setters.setRejectingRequest]) // rejectingRequest
    .mockReturnValueOnce(['', setters.setRejectionReason]) // rejectionReason
    .mockReturnValueOnce([null, setters.setRevokingRequest]); // revokingRequest
}

function renderScreen() {
  const setters = {
    setItems: vi.fn(),
    setError: vi.fn(),
    setSuccess: vi.fn(),
    setProcessingIds: vi.fn(),
    setRejectingRequest: vi.fn(),
    setRejectionReason: vi.fn(),
    setRevokingRequest: vi.fn(),
  };
  stubUseState(setters);
  const element = StaffRequestsScreen();
  if (!isValidElement<ScreenProps>(element)) {
    throw new Error('StaffRequestsScreen must return a React element.');
  }
  return { element, ...setters };
}

describe('StaffRequestsScreen', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('ADMIN 승인이 성공하면 성공 메시지를 표시하고 처리중 표시를 해제한다', async () => {
    // Given
    mocks.decideStaffRoleRequest.mockResolvedValue({
      ...pendingRequest,
      status: 'APPROVED',
      decidedBy: 'synthetic-admin',
    });
    const { element, setSuccess, setProcessingIds, setRejectingRequest } =
      renderScreen();

    // When
    element.props.onApprove(pendingRequest);
    await vi.waitFor(() =>
      expect(mocks.decideStaffRoleRequest).toHaveBeenCalled(),
    );

    // Then
    expect(mocks.decideStaffRoleRequest).toHaveBeenCalledWith('request-1', {
      action: 'APPROVE',
    });
    expect(setSuccess).toHaveBeenCalledWith(
      expect.stringContaining('승인했습니다'),
    );
    expect(setRejectingRequest).toHaveBeenCalledWith(null);
    const processingCalls = setProcessingIds.mock.calls;
    expect(processingCalls.length).toBeGreaterThanOrEqual(2);
    const cleared = processingCalls[processingCalls.length - 1][0](
      new Set(['request-1']),
    );
    expect(cleared.has('request-1')).toBe(false);
    expect(mocks.fetchStaffRoleRequests).not.toHaveBeenCalled();
  });

  it('다른 관리자가 먼저 처리해 409가 반환되면 목록을 되돌리고 실제로 다시 불러온다', async () => {
    // Given
    const conflict = new ApiError({
      type: 'about:blank',
      title: 'CONFLICT',
      status: 409,
      detail: '다른 관리자가 이미 처리한 요청입니다.',
      instance: '/role-requests/request-1',
      code: 'ROL_007',
    });
    mocks.decideStaffRoleRequest.mockRejectedValue(conflict);
    mocks.fetchStaffRoleRequests.mockResolvedValue({
      items: [{ ...pendingRequest, status: 'APPROVED' }],
      page: 1,
      limit: 20,
      total: 1,
    });
    const { element, setItems, setError } = renderScreen();

    // When
    element.props.onApprove(pendingRequest);
    await vi.waitFor(() =>
      expect(mocks.fetchStaffRoleRequests).toHaveBeenCalled(),
    );

    // Then — 실제 목록 재조회(UI reload)가 일어났음을 증명한다.
    expect(mocks.fetchStaffRoleRequests).toHaveBeenCalledTimes(1);
    expect(setItems).toHaveBeenCalledWith([pendingRequest]); // 낙관적 갱신 롤백
    expect(setItems).toHaveBeenLastCalledWith([
      { ...pendingRequest, status: 'APPROVED' },
    ]); // 재조회 결과 반영
    expect(setError).toHaveBeenCalledWith(
      '다른 관리자가 먼저 처리했습니다. 최신 목록을 불러왔습니다.',
    );
  });

  it('충돌이 아닌 일반 오류는 목록만 되돌리고 다시 불러오지 않는다', async () => {
    // Given
    mocks.decideStaffRoleRequest.mockRejectedValue(new Error('network down'));
    const { element, setItems, setError } = renderScreen();

    // When
    element.props.onApprove(pendingRequest);
    await vi.waitFor(() => expect(setError).toHaveBeenCalled());

    // Then
    expect(setItems).toHaveBeenCalledWith([pendingRequest]);
    expect(mocks.fetchStaffRoleRequests).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(
      '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  });
});
