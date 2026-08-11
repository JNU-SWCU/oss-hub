// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

type ProgramEditPageProps = {
  readonly programId: string;
  readonly isAdmin: boolean;
};

const session = vi.hoisted(() => ({
  role: null as string | null,
}));

const captured = vi.hoisted(() => ({
  props: null as ProgramEditPageProps | null,
}));

vi.mock('../../../_shell/session-role-context', () => ({
  useSharedSessionRole: () => ({ role: session.role }),
}));

vi.mock('@/features/programs/program-edit-page', () => ({
  ProgramEditPage: (props: ProgramEditPageProps) => {
    captured.props = props;
    return null;
  },
}));

import { ProgramEditRoute } from './program-edit-route';

// #875 — 셸이 물려준 세션 역할로 「위험 영역」 노출 여부(isAdmin)를 가른다. ADMIN만
// true이고, STAFF를 포함한 나머지 역할은 모두 false다 — 백엔드도 STAFF를 403으로
// 거절하므로 화면은 그 버튼조차 보여주지 않는다.
describe('ProgramEditRoute', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    captured.props = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('ADMIN이면 isAdmin=true를 ProgramEditPage로 넘긴다', async () => {
    session.role = 'ADMIN';

    await act(async () => {
      root.render(<ProgramEditRoute programId="program-1" />);
    });

    expect(captured.props).toEqual({
      programId: 'program-1',
      isAdmin: true,
    });
  });

  it('STAFF면 isAdmin=false를 넘긴다 — 프로그램 생성자여도 위험 영역을 보지 못한다', async () => {
    session.role = 'STAFF';

    await act(async () => {
      root.render(<ProgramEditRoute programId="program-1" />);
    });

    expect(captured.props).toEqual({
      programId: 'program-1',
      isAdmin: false,
    });
  });

  it('programId를 그대로 전달한다', async () => {
    session.role = 'ADMIN';

    await act(async () => {
      root.render(<ProgramEditRoute programId="program:with-colon" />);
    });

    expect(captured.props?.programId).toBe('program:with-colon');
  });
});
