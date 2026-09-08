// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const { getEditableProgramMock, purgeProgramMock } = vi.hoisted(() => ({
  getEditableProgramMock: vi.fn(),
  purgeProgramMock: vi.fn(),
}));

vi.mock('./api', () => ({
  getEditableProgram: getEditableProgramMock,
  purgeProgram: purgeProgramMock,
}));

import { ProgramEditDangerZoneSection } from './program-edit-danger-zone-section';

function getButton(
  name: string,
  scope: ParentNode = document,
): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

const deletionScopeCounts = {
  applications: 2,
  teams: 3,
  boardPosts: 4,
  submissions: 5,
  submissionEvents: 6,
  scopeFingerprint: '0123456789abcdef0123456789abcdef',
};

const zeroDeletionScopeCounts = {
  applications: 0,
  teams: 0,
  boardPosts: 0,
  submissions: 0,
  submissionEvents: 0,
  scopeFingerprint: 'fedcba9876543210fedcba9876543210',
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function openDialog() {
  await act(async () => {
    getButton('프로그램 삭제').click();
  });
  const dialog = document.querySelector('[role="alertdialog"]');
  if (dialog === null) throw new TypeError('Missing dialog.');
  return dialog;
}

describe('ProgramEditDangerZoneSection', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onDeleted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    onDeleted = vi.fn();
    getEditableProgramMock.mockReset();
    getEditableProgramMock.mockResolvedValue({ deletionScopeCounts });
    purgeProgramMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body
      .querySelectorAll('[data-radix-portal]')
      .forEach((portal) => portal.remove());
  });

  it('권한이 없으면 삭제 섹션을 렌더링하지 않는다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          canDeleteProgram={false}
          onDeleted={onDeleted}
        />,
      );
    });

    expect(container.textContent).toBe('');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('권한이 있으면 프로그램 삭제 버튼 하나만 렌더링하고 내리기 안내를 보이지 않는다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          canDeleteProgram
          onDeleted={onDeleted}
        />,
      );
    });

    expect(getButton('프로그램 삭제').disabled).toBe(false);
    expect(container.textContent).not.toContain('아카이브');
    expect(container.textContent).not.toContain('내리기');
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('프로그램 삭제는 이름과 되돌릴 수 없는 경고, 현재 삭제 범위를 보여준다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          canDeleteProgram
          onDeleted={onDeleted}
        />,
      );
    });

    const dialog = await openDialog();
    await flush();

    expect(getEditableProgramMock).toHaveBeenCalledWith('program-1');
    expect(dialog.textContent).toContain('프로그램을 삭제할까요?');
    expect(dialog.textContent).toContain('OSS 프로그램');
    expect(dialog.textContent).toContain('이 작업은 되돌릴 수 없습니다.');
    expect(dialog.textContent).toContain(
      '지원서 2건 · 팀 3개 · 게시글 4건 · 제출물 5건',
    );
    expect(dialog.querySelector('input')).toBeNull();
    expect(getButton('취소', dialog)).toBeInstanceOf(HTMLButtonElement);
    expect(getButton('삭제', dialog).disabled).toBe(false);
  });

  it('삭제 범위를 읽는 동안 삭제를 비활성화하고 취소하면 늦은 응답을 무시한다', async () => {
    let resolveScope:
      | ((value: { deletionScopeCounts: typeof deletionScopeCounts }) => void)
      | undefined;
    getEditableProgramMock.mockReturnValue(
      new Promise((resolve) => {
        resolveScope = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          canDeleteProgram
          onDeleted={onDeleted}
        />,
      );
    });
    const dialog = await openDialog();

    expect(getButton('삭제 범위 확인 중…', dialog).disabled).toBe(true);
    await act(async () => {
      getButton('취소', dialog).click();
    });
    resolveScope?.({ deletionScopeCounts });
    await flush();

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(purgeProgramMock).not.toHaveBeenCalled();
  });

  it('삭제 범위를 읽지 못하면 오류를 보여주고 삭제를 비활성화한다', async () => {
    getEditableProgramMock.mockRejectedValue(new Error('scope unavailable'));
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          canDeleteProgram
          onDeleted={onDeleted}
        />,
      );
    });

    const dialog = await openDialog();
    await flush();

    expect(dialog.textContent).toContain(
      '삭제 범위를 확인하지 못했습니다. 다시 시도해 주세요.',
    );
    expect(getButton('삭제', dialog).disabled).toBe(true);
  });

  it('확정은 마지막으로 표시한 전체 범위와 fingerprint를 그대로 한 번만 보낸다', async () => {
    let resolvePurge:
      | ((value: {
          id: string;
          deleted: true;
          deletedCounts: { applications: number; teams: number };
        }) => void)
      | undefined;
    purgeProgramMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePurge = resolve;
      }),
    );
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          canDeleteProgram
          onDeleted={onDeleted}
        />,
      );
    });

    const dialog = await openDialog();
    await flush();
    await act(async () => getButton('삭제', dialog).click());
    await act(async () => getButton('삭제 중…', dialog).click());

    expect(purgeProgramMock).toHaveBeenCalledTimes(1);
    expect(purgeProgramMock).toHaveBeenCalledWith(
      'program-1',
      deletionScopeCounts,
    );
    expect(getButton('삭제 중…', dialog).disabled).toBe(true);

    resolvePurge?.({
      id: 'program-1',
      deleted: true,
      deletedCounts: { applications: 2, teams: 1 },
    });
    await flush();
    expect(onDeleted).toHaveBeenCalledWith('지원서 2건 · 팀 1건');
  });

  it('PRG_014는 자동 재시도하지 않고 갱신된 범위로 명시적 재확인을 요구한다', async () => {
    const changedCounts = {
      applications: 6,
      teams: 7,
      boardPosts: 8,
      submissions: 9,
      submissionEvents: 10,
      scopeFingerprint: 'fedcba9876543210fedcba9876543210',
    };
    purgeProgramMock.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Purge scope changed',
        status: 409,
        detail: '',
        code: 'PRG_014',
        instance: '/programs/program-1/purge',
        ...{ currentScopeCounts: changedCounts },
      }),
    );
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          canDeleteProgram
          onDeleted={onDeleted}
        />,
      );
    });

    const dialog = await openDialog();
    await flush();
    await act(async () => getButton('삭제', dialog).click());
    await flush();

    expect(purgeProgramMock).toHaveBeenCalledTimes(1);
    expect(getEditableProgramMock).toHaveBeenCalledTimes(1);
    expect(dialog.textContent).toContain(
      '삭제 범위가 변경되었습니다. 내용을 확인한 뒤 삭제를 다시 눌러 주세요.',
    );
    expect(dialog.textContent).toContain(
      '지원서 6건 · 팀 7개 · 게시글 8건 · 제출물 9건',
    );

    purgeProgramMock.mockResolvedValueOnce({
      id: 'program-1',
      deleted: true,
      deletedCounts: { applications: 6 },
    });
    await act(async () => getButton('삭제', dialog).click());
    await flush();

    expect(purgeProgramMock).toHaveBeenCalledTimes(2);
    expect(purgeProgramMock).toHaveBeenLastCalledWith(
      'program-1',
      changedCounts,
    );
  });

  it('0건 범위도 표시하고 취소는 purge를 호출하지 않는다', async () => {
    getEditableProgramMock.mockResolvedValue({
      deletionScopeCounts: zeroDeletionScopeCounts,
    });
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          canDeleteProgram
          onDeleted={onDeleted}
        />,
      );
    });

    const dialog = await openDialog();
    await flush();
    expect(dialog.textContent).toContain('연결된 데이터 없음');
    await act(async () => getButton('취소', dialog).click());
    expect(purgeProgramMock).not.toHaveBeenCalled();
  });

  it('권한 오류는 성공 콜백 없이 오류를 보여준다', async () => {
    purgeProgramMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: '전체 삭제 권한이 없습니다.',
        code: 'PRG_011',
        instance: '/programs/program-1/purge',
      }),
    );
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          canDeleteProgram
          onDeleted={onDeleted}
        />,
      );
    });

    const dialog = await openDialog();
    await flush();
    await act(async () => getButton('삭제', dialog).click());
    await flush();

    expect(dialog.textContent).toContain('전체 삭제 권한이 없습니다.');
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
