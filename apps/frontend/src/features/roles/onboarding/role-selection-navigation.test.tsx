import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  selectRole: vi.fn(),
  useState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: mocks.useState };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}));

vi.mock('./api', () => ({ selectRole: mocks.selectRole }));

import {
  navigateAfterRoleSelection,
  RoleSelectionScreen,
} from './components/role-selection-screen';

interface RoleSelectionScreenElementProps {
  readonly selectedRole: 'STUDENT' | 'STAFF' | null;
  readonly onSubmit: () => void;
}

function renderScreen(
  props: Parameters<typeof RoleSelectionScreen>[0],
): RoleSelectionScreenElementProps {
  const element = RoleSelectionScreen(props);
  if (!isValidElement<RoleSelectionScreenElementProps>(element)) {
    throw new Error('RoleSelectionScreen must return a React element.');
  }
  return element.props;
}

describe('role selection navigation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { location: { assign: mocks.assign } });

    mocks.useState
      .mockReturnValueOnce(['STUDENT', vi.fn()])
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('결과 경로를 문서 navigation 경계에 위임한다', () => {
    const navigation = { assign: vi.fn() };

    navigateAfterRoleSelection('/programs', navigation);

    expect(navigation.assign).toHaveBeenCalledWith('/programs');
  });

  it('학생 역할 저장 성공 시 새 문서로 결과 경로를 연다', async () => {
    mocks.selectRole.mockResolvedValue({
      selectedRole: 'STUDENT',
      redirectTo: '/programs',
    });
    const screen = renderScreen({
      initialSelectedRole: null,
      rejection: null,
    });

    screen.onSubmit();
    await vi.waitFor(() => expect(mocks.selectRole).toHaveBeenCalled());

    expect(mocks.assign).toHaveBeenCalledWith('/programs');
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('이전 선택 되살리기', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { location: { assign: mocks.assign } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['STUDENT', 'STAFF'] as const)(
    '%s을 골랐던 사람은 그 카드가 고른 상태로 시작한다',
    (role) => {
      const setSelectedRole = vi.fn();
      mocks.useState
        .mockImplementationOnce((initial: unknown) => [
          initial,
          setSelectedRole,
        ])
        .mockReturnValueOnce([false, vi.fn()])
        .mockReturnValueOnce([null, vi.fn()]);

      const screen = renderScreen({
        initialSelectedRole: role,
        rejection: null,
      });

      expect(screen.selectedRole).toBe(role);
      expect(setSelectedRole).not.toHaveBeenCalled();
    },
  );

  it('고른 적이 없으면 아무 카드도 고르지 않은 상태로 시작한다', () => {
    mocks.useState
      .mockImplementationOnce((initial: unknown) => [initial, vi.fn()])
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]);

    const screen = renderScreen({
      initialSelectedRole: null,
      rejection: null,
    });

    expect(screen.selectedRole).toBe(null);
  });
});
