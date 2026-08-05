import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  selectRole: vi.fn(),
  useState: vi.fn(),
}));

/**
 * 이 화면을 React 없이 함수로 직접 부르는 검사라, 화면이 쓰는 훅을 대신 세워 둔다.
 *
 * **예전보다 세울 것이 적다.** 이 컴포넌트는 더 이상 스스로 조회하지 않아
 * (`useEffect`·`useRef`가 사라졌다) 남은 훅은 `useState` 셋뿐이다 — 고른 역할 ·
 * 저장 중 · 오류 문구. 이전 선택은 조회가 아니라 `initialSelectedRole` prop으로
 * 들어온다(#673에서 게이트 스냅샷 경로로 옮겼다).
 */
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

/** 화면이 돌려준 폼 엘리먼트. 훅을 대신 세운 상태라 렌더 트리 없이 props만 본다. */
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
    // 호출 순서 = 고른 역할 → 저장 중 → 오류 문구.
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
      redirectTo: '/programs',
    });
    const screen = renderScreen({
      initialSelectedRole: null,
      rejection: null,
    });

    // When
    screen.onSubmit();
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
 *
 * **되살리는 경로가 바뀌었다**(#673). 예전에는 이 화면이 마운트 후 `fetchMyRoleSelection`
 * 을 직접 불러 뒤늦게 채웠고, 그 사이 사용자가 카드를 누르면 늦게 도착한 응답이 선택을
 * 덮어쓸 수 있어 `hasChosen` ref로 막아야 했다. 지금은 게이트가 **두 조회가 끝난 뒤에만**
 * 자식을 그리므로(`status === 'unassigned'`가 `loaded`를 전제한다) 첫 렌더부터 값이 있고,
 * 늦게 도착하는 응답 자체가 없다. 그래서 ref가 사라졌다 — 없앤 것이 아니라 **필요 없어진**
 * 것이다.
 *
 * 조회 실패 정책도 이 화면에서 게이트로 옮겨 갔다. 예전 이 파일의 "조회에 실패해도 화면을
 * 오류로 접지 않는다"는 이 컴포넌트의 **중복 조회**에 대한 것이었는데, 게이트는 그전부터
 * 같은 조회의 실패를 `error`로 접어 `SessionError`를 띄우고 있었다. 즉 사용자가 보는
 * 결과는 달라지지 않는다. 지금 그 계약을 지키는 곳은 `_shell/use-session-role.ts`다.
 */
describe('이전 선택 되살리기', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { location: { assign: mocks.assign } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['STUDENT', 'STAFF'] as const)(
    '%s을 골랐던 사람은 그 카드가 고른 상태로 시작한다',
    (role) => {
      // Given: 훅을 실제 초기값대로 흉내 낸다 — 첫 `useState`가 prop을 받는다.
      const setSelectedRole = vi.fn();
      mocks.useState
        .mockImplementationOnce((initial: unknown) => [
          initial,
          setSelectedRole,
        ])
        .mockReturnValueOnce([false, vi.fn()])
        .mockReturnValueOnce([null, vi.fn()]);

      // When
      const screen = renderScreen({
        initialSelectedRole: role,
        rejection: null,
      });

      // Then: 되살리기 위해 아무것도 조회하지 않는다.
      expect(screen.selectedRole).toBe(role);
      expect(setSelectedRole).not.toHaveBeenCalled();
    },
  );

  it('고른 적이 없으면 아무 카드도 고르지 않은 상태로 시작한다', () => {
    // Given
    mocks.useState
      .mockImplementationOnce((initial: unknown) => [initial, vi.fn()])
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([null, vi.fn()]);

    // When
    const screen = renderScreen({
      initialSelectedRole: null,
      rejection: null,
    });

    // Then
    expect(screen.selectedRole).toBe(null);
  });
});
