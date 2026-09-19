// @vitest-environment happy-dom

import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { TeamDeletionScope } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const { deleteStaffProgramTeamMock } = vi.hoisted(() => ({
  deleteStaffProgramTeamMock: vi.fn(),
}));

vi.mock('./api', () => ({
  deleteStaffProgramTeam: deleteStaffProgramTeamMock,
}));

import { TeamDeleteDialog } from './team-delete-dialog';

const scope: TeamDeletionScope = {
  applications: 1,
  members: 3,
  invitations: 0,
  submissions: 0,
  submissionEvents: 0,
  detachedRepositories: 1,
  scopeFingerprint: '0123456789abcdef0123456789abcdef',
};

const changedScope: TeamDeletionScope = {
  applications: 2,
  members: 3,
  invitations: 1,
  submissions: 0,
  submissionEvents: 0,
  detachedRepositories: 1,
  scopeFingerprint: 'fedcba9876543210fedcba9876543210',
};

function getButton(
  name: string,
  parent: ParentNode = document,
): HTMLButtonElement {
  const button = [...parent.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

function Harness({
  onDeleted = () => {},
  onCancel = () => {},
}: {
  readonly onDeleted?: (summary: string) => void;
  readonly onCancel?: () => void;
}) {
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={returnFocusRef} type="button">
        팀 삭제
      </button>
      <TeamDeleteDialog
        programId="program-1"
        teamId="team-1"
        teamName="오픈소스팀"
        scope={scope}
        returnFocusRef={returnFocusRef}
        onDeleted={onDeleted}
        onCancel={onCancel}
      />
    </>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('TeamDeleteDialog', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onDeleted: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    onDeleted = vi.fn();
    onCancel = vi.fn();
    deleteStaffProgramTeamMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body
      .querySelectorAll('[data-radix-portal]')
      .forEach((portal) => portal.remove());
  });

  async function renderDialog(): Promise<HTMLElement> {
    await act(async () => {
      root.render(<Harness onDeleted={onDeleted} onCancel={onCancel} />);
    });
    const dialog = document.querySelector('[role="dialog"]');
    if (!(dialog instanceof HTMLElement)) {
      throw new TypeError('삭제 확인 창이 없다');
    }
    return dialog;
  }

  it('취소를 누르면 요청하지 않고 닫는다', async () => {
    const dialog = await renderDialog();
    await act(async () => getButton('취소', dialog).click());

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(deleteStaffProgramTeamMock).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('확인은 화면에 보여 준 범위를 그대로 한 번만 보내고 요약을 넘긴다', async () => {
    deleteStaffProgramTeamMock.mockResolvedValue({
      teamId: 'team-1',
      deleted: true,
      deletedCounts: {
        applications: 1,
        members: 3,
        invitations: 0,
        submissions: 0,
        submissionEvents: 0,
        detachedRepositories: 1,
      },
    });
    const dialog = await renderDialog();

    expect(dialog.textContent).toContain('오픈소스팀');
    expect(dialog.textContent).toContain('지원서 1건 · 팀원 3명');
    expect(dialog.textContent).toContain(
      '연결된 GitHub 저장소는 삭제하지 않고 연결만 해제합니다 (1건).',
    );
    expect(getButton('삭제', dialog).className).toContain('destructive');

    await act(async () => getButton('삭제', dialog).click());
    await flush();

    expect(deleteStaffProgramTeamMock).toHaveBeenCalledTimes(1);
    expect(deleteStaffProgramTeamMock).toHaveBeenCalledWith(
      'program-1',
      'team-1',
      scope,
    );
    expect(onDeleted).toHaveBeenCalledWith(
      '지원서 1건 · 팀원 3명 · 저장소 연결 해제 1건',
    );
  });

  it('TEAM_019는 자동 재시도하지 않고 갱신된 범위로 명시적 재확인을 요구한다', async () => {
    deleteStaffProgramTeamMock.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Team scope changed',
        status: 409,
        detail: '',
        code: 'TEAM_019',
        instance: '/programs/program-1/teams/team-1',
        ...{ currentTeamScopeCounts: changedScope },
      }),
    );
    const dialog = await renderDialog();
    await act(async () => getButton('삭제', dialog).click());
    await flush();

    expect(deleteStaffProgramTeamMock).toHaveBeenCalledTimes(1);
    expect(dialog.textContent).toContain(
      '삭제 범위가 변경되었습니다. 내용을 확인한 뒤 삭제를 다시 눌러 주세요.',
    );
    expect(dialog.textContent).toContain('지원서 2건 · 팀원 3명 · 초대 1건');
    expect(onDeleted).not.toHaveBeenCalled();

    deleteStaffProgramTeamMock.mockResolvedValueOnce({
      teamId: 'team-1',
      deleted: true,
      deletedCounts: {
        applications: 2,
        members: 3,
        invitations: 1,
        submissions: 0,
        submissionEvents: 0,
        detachedRepositories: 1,
      },
    });
    await act(async () => getButton('삭제', dialog).click());
    await flush();

    expect(deleteStaffProgramTeamMock).toHaveBeenCalledTimes(2);
    expect(deleteStaffProgramTeamMock).toHaveBeenLastCalledWith(
      'program-1',
      'team-1',
      changedScope,
    );
    expect(onDeleted).toHaveBeenCalledWith(
      '지원서 2건 · 팀원 3명 · 초대 1건 · 저장소 연결 해제 1건',
    );
  });

  it('권한 오류는 창 안에서 말하고 성공 콜백을 부르지 않는다', async () => {
    deleteStaffProgramTeamMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: '교직원만 팀을 삭제할 수 있습니다.',
        code: 'TEAM_018',
        instance: '/programs/program-1/teams/team-1',
      }),
    );
    const dialog = await renderDialog();
    await act(async () => getButton('삭제', dialog).click());
    await flush();

    expect(dialog.textContent).toContain('교직원만 팀을 삭제할 수 있습니다.');
    expect(onDeleted).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
});
