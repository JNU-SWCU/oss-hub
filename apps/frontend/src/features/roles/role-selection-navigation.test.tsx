import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  selectRole: vi.fn(),
  fetchMyRoleSelection: vi.fn(),
  fetchMyRoleRequest: vi.fn(),
  useState: vi.fn(),
  useEffect: vi.fn(),
}));

// 이 화면을 React 없이 함수로 직접 부르는 검사라, 화면이 쓰는 훅을 모두 대신
// 세워 둬야 한다. `useEffect`·`useRef`는 이전 선택을 되살리는 조회가 쓴다(#569) —
// 여기서 확인할 것은 저장 성공 뒤의 이동이므로 조회는 아무 일도 하지 않게 둔다.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: mocks.useState,
    useEffect: (effect: () => void, deps?: unknown[]) =>
      mocks.useEffect(effect, deps),
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}));

vi.mock('./api', () => ({
  selectRole: mocks.selectRole,
  fetchMyRoleSelection: mocks.fetchMyRoleSelection,
  // 반려 사유도 같은 effect에서 함께 읽는다(#673). 여기서는 조회 결과가 아니라
  // 저장 뒤의 이동을 보므로, 요청이 없는 사람(=대부분의 첫 가입자)으로 둔다.
  fetchMyRoleRequest: mocks.fetchMyRoleRequest,
}));

import {
  navigateAfterRoleSelection,
  RoleSelectionScreen,
} from './components/role-selection-screen';

interface RoleSelectionScreenElementProps {
  readonly onSubmit: () => void;
}

describe('role selection navigation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { location: { assign: mocks.assign } });
    mocks.fetchMyRoleSelection.mockResolvedValue({ selectedRole: null });
    mocks.fetchMyRoleRequest.mockResolvedValue(null);
    mocks.useEffect.mockImplementation(() => {});
    // 호출 순서 = 고른 역할 → 반려 안내 → 저장 중 → 오류 문구.
    mocks.useState
      .mockReturnValueOnce(['STUDENT', vi.fn()])
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('결과 경로를 문서 navigation 경계에 위임한다', () => {
    // Given
    const navigation = { assign: vi.fn() };

    // When
    navigateAfterRoleSelection('/programs', navigation);

    // Then
    expect(navigation.assign).toHaveBeenCalledWith('/programs');
  });

  it('학생 역할 저장 성공 시 새 문서로 결과 경로를 연다', async () => {
    // Given
    mocks.selectRole.mockResolvedValue({
      selectedRole: 'STUDENT',
      redirectTo: '/programs',
    });
    const screen = RoleSelectionScreen();
    if (!isValidElement<RoleSelectionScreenElementProps>(screen)) {
      throw new Error('RoleSelectionScreen must return a React element.');
    }

    // When
    screen.props.onSubmit();
    await vi.waitFor(() => expect(mocks.selectRole).toHaveBeenCalled());

    // Then
    expect(mocks.assign).toHaveBeenCalledWith('/programs');
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

/**
 * #569 — 되돌아온 사람에게 이전 선택을 되살린다.
 *
 * 확정을 `가입 마치기`로 미루면서 프로필 화면에서 이 화면으로 되돌아올 수 있게 됐다.
 * 되돌아왔는데 아무것도 골라지지 않은 화면이 뜨면, 사용자는 자기가 무엇을 골랐었는지
 * 화면에서 확인할 수 없어 방금 한 선택이 지워진 것으로 읽는다.
 */
describe('이전 선택 되살리기', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { location: { assign: mocks.assign } });
    // 이 검사에서는 조회 effect가 실제로 돌아야 한다.
    mocks.useEffect.mockImplementation((effect: () => void) => {
      effect();
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('저장된 선택을 읽어 카드를 고른 상태로 되돌린다', async () => {
    // Given
    const setSelectedRole = vi.fn();
    mocks.useState
      .mockReturnValueOnce([null, setSelectedRole])
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]);
    mocks.fetchMyRoleSelection.mockResolvedValue({ selectedRole: 'STAFF' });
    mocks.fetchMyRoleRequest.mockResolvedValue(null);

    // When
    RoleSelectionScreen();

    // Then
    await vi.waitFor(() =>
      expect(setSelectedRole).toHaveBeenCalledWith('STAFF'),
    );
  });

  it('조회에 실패해도 화면을 오류로 접지 않는다', async () => {
    // Given — 처음 온 사람은 고른 것이 없는 것이 정상이라, 여기서 오류를 띄우면
    // 아무 잘못도 없는 사용자가 실패 화면을 본다.
    const setSelectedRole = vi.fn();
    mocks.useState
      .mockReturnValueOnce([null, setSelectedRole])
      .mockReturnValueOnce([null, vi.fn()])
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]);
    mocks.fetchMyRoleSelection.mockRejectedValue(new Error('조회 실패'));
    mocks.fetchMyRoleRequest.mockRejectedValue(new Error('조회 실패'));

    // When / Then
    expect(() => RoleSelectionScreen()).not.toThrow();
    await vi.waitFor(() =>
      expect(mocks.fetchMyRoleSelection).toHaveBeenCalled(),
    );
    expect(setSelectedRole).not.toHaveBeenCalled();
  });
});
