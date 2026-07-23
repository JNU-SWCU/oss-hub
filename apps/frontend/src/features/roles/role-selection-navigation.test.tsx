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
  readonly onSubmit: () => void;
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
      role: 'STUDENT',
      requestStatus: null,
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
