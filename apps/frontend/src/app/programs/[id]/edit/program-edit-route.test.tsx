import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

type ProgramEditPageProps = {
  readonly programId: string;
  readonly canDeleteProgram: boolean;
};

const session = vi.hoisted(() => ({
  hasStaffAccess: false,
  hasAdminAccess: false,
}));

const captured = vi.hoisted(() => ({
  props: null as ProgramEditPageProps | null,
}));

vi.mock('../../../_shell/session-role-context', () => ({
  useSharedSessionRole: () => ({
    hasStaffAccess: session.hasStaffAccess,
    hasAdminAccess: session.hasAdminAccess,
  }),
}));

vi.mock('@/features/programs/program-edit-page', () => ({
  ProgramEditPage: (props: ProgramEditPageProps) => {
    captured.props = props;
    return null;
  },
}));

import { ProgramEditRoute } from './program-edit-route';

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

  it('관리자 접근이 있으면 canDeleteProgram=true를 ProgramEditPage로 넘긴다', async () => {
    session.hasStaffAccess = false;
    session.hasAdminAccess = true;

    await act(async () => {
      root.render(<ProgramEditRoute programId="program-1" />);
    });

    expect(captured.props).toEqual({
      programId: 'program-1',
      canDeleteProgram: true,
    });
  });

  it('교직원 접근만 있어도 canDeleteProgram=true를 넘긴다 — 자기 화면에서 삭제까지 한다', async () => {
    session.hasStaffAccess = true;
    session.hasAdminAccess = false;

    await act(async () => {
      root.render(<ProgramEditRoute programId="program-1" />);
    });

    expect(captured.props).toEqual({
      programId: 'program-1',
      canDeleteProgram: true,
    });
  });

  it('교직원·관리자 접근이 모두 없으면 canDeleteProgram=false를 넘긴다', async () => {
    session.hasStaffAccess = false;
    session.hasAdminAccess = false;

    await act(async () => {
      root.render(<ProgramEditRoute programId="program-1" />);
    });

    expect(captured.props).toEqual({
      programId: 'program-1',
      canDeleteProgram: false,
    });
  });

  it('programId를 그대로 전달한다', async () => {
    session.hasStaffAccess = true;
    session.hasAdminAccess = false;

    await act(async () => {
      root.render(<ProgramEditRoute programId="program:with-colon" />);
    });

    expect(captured.props?.programId).toBe('program:with-colon');
  });
});
