import { isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `admin-users.test.tsx`는 `AdminUsersView`(순수 표시 컴포넌트)와
 * `role-change-policy`의 순수 함수만 검증한다. 실제 역할 변경 흐름을 쥐고 있는
 * `AdminUsersScreen`(컨테이너)의 목록 재조회/redirect 분기는 어디서도 실행되지 않았다.
 * `role-selection-navigation.test.tsx`와 동일한 관례(useState/useCallback/useEffect 대체 후
 * 컨테이너 함수를 직접 호출)로 실 실행 경로를 고정한다.
 */

const mocks = vi.hoisted(() => ({
  useState: vi.fn(),
  replace: vi.fn(),
  fetchAdminUsers: vi.fn(),
  updateAdminUserRole: vi.fn(),
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('../api', () => ({
  fetchAdminUsers: mocks.fetchAdminUsers,
  updateAdminUserRole: mocks.updateAdminUserRole,
}));

import { AdminUsersScreen } from './admin-users-screen';
import type { AdminUser } from '../types';

interface ScreenProps {
  readonly onConfirmRoleChange: () => void;
}

const otherStaff: AdminUser = {
  id: 'user-other',
  githubLogin: 'other-staff',
  name: '합성 교직원',
  role: 'STAFF',
  accountStatus: 'ACTIVE',
  isSelf: false,
};

const selfAdmin: AdminUser = {
  id: 'user-self',
  githubLogin: 'self-admin',
  name: '합성 관리자',
  role: 'ADMIN',
  accountStatus: 'ACTIVE',
  isSelf: true,
};

/** 컴포넌트 소스의 `useState` 선언 순서와 반드시 일치해야 한다. */
function stubUseState(
  confirmation: { readonly user: AdminUser; readonly role: string } | null,
  setters: {
    readonly setItems: ReturnType<typeof vi.fn>;
    readonly setError: ReturnType<typeof vi.fn>;
    readonly setSuccess: ReturnType<typeof vi.fn>;
    readonly setProcessingId: ReturnType<typeof vi.fn>;
    readonly setConfirmation: ReturnType<typeof vi.fn>;
  },
) {
  mocks.useState
    .mockReturnValueOnce([[], setters.setItems]) // items
    .mockReturnValueOnce(['', vi.fn()]) // queryInput
    .mockReturnValueOnce(['', vi.fn()]) // query
    .mockReturnValueOnce(['', vi.fn()]) // role
    .mockReturnValueOnce([false, vi.fn()]) // isLoading
    .mockReturnValueOnce([null, setters.setError]) // error
    .mockReturnValueOnce([null, setters.setSuccess]) // success
    .mockReturnValueOnce([null, setters.setProcessingId]) // processingId
    .mockReturnValueOnce([confirmation, setters.setConfirmation]); // confirmation
}

function renderScreen(
  confirmation: { readonly user: AdminUser; readonly role: string } | null,
) {
  const setters = {
    setItems: vi.fn(),
    setError: vi.fn(),
    setSuccess: vi.fn(),
    setProcessingId: vi.fn(),
    setConfirmation: vi.fn(),
  };
  stubUseState(confirmation, setters);
  const element = AdminUsersScreen();
  if (!isValidElement<ScreenProps>(element)) {
    throw new Error('AdminUsersScreen must return a React element.');
  }
  return { element, ...setters };
}

describe('AdminUsersScreen', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('자기 자신이 아닌 사용자의 역할 변경 성공 시 목록을 실제로 다시 불러온다', async () => {
    // Given
    mocks.updateAdminUserRole.mockResolvedValue({
      ...otherStaff,
      role: 'STUDENT',
    });
    mocks.fetchAdminUsers.mockResolvedValue([
      { ...otherStaff, role: 'STUDENT' },
    ]);
    const { element, setSuccess, setConfirmation } = renderScreen({
      user: otherStaff,
      role: 'STUDENT',
    });

    // When
    element.props.onConfirmRoleChange();
    await vi.waitFor(() => expect(mocks.fetchAdminUsers).toHaveBeenCalled());

    // Then — 실제 목록 재조회(UI reload)가 일어났고 redirect는 없었다.
    expect(mocks.updateAdminUserRole).toHaveBeenCalledWith(
      'user-other',
      'STUDENT',
    );
    expect(mocks.fetchAdminUsers).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(setSuccess).toHaveBeenCalledWith(
      expect.stringContaining('역할을 변경했습니다'),
    );
    expect(setConfirmation).toHaveBeenCalledWith(null);
  });

  it('자기 ADMIN 역할을 해제하면 새 역할 홈으로 redirect하고 목록은 다시 불러오지 않는다', async () => {
    // Given
    mocks.updateAdminUserRole.mockResolvedValue({
      ...selfAdmin,
      role: 'STUDENT',
    });
    const { element, setSuccess } = renderScreen({
      user: selfAdmin,
      role: 'STUDENT',
    });

    // When
    element.props.onConfirmRoleChange();
    await vi.waitFor(() =>
      expect(mocks.updateAdminUserRole).toHaveBeenCalled(),
    );

    // Then
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard');
    expect(mocks.fetchAdminUsers).not.toHaveBeenCalled();
    expect(setSuccess).toHaveBeenCalledWith(
      expect.stringContaining('역할을 변경했습니다'),
    );
  });

  it('역할 변경이 실패하면 오류 메시지를 표시하고 목록을 다시 불러오지 않는다', async () => {
    // Given
    mocks.updateAdminUserRole.mockRejectedValue(new Error('network down'));
    const { element, setError, setConfirmation } = renderScreen({
      user: otherStaff,
      role: 'STUDENT',
    });

    // When
    element.props.onConfirmRoleChange();
    await vi.waitFor(() => expect(setError).toHaveBeenCalled());

    // Then
    expect(mocks.fetchAdminUsers).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(
      '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
    expect(setConfirmation).not.toHaveBeenCalledWith(null);
  });
});
