// @vitest-environment happy-dom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { PROGRAM_DELETE_BLOCKED_CODE } from './program-edit-delete-flow';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const { deleteProgramMock, getEditableProgramMock, purgeProgramMock } =
  vi.hoisted(() => ({
    deleteProgramMock: vi.fn(),
    getEditableProgramMock: vi.fn(),
    purgeProgramMock: vi.fn(),
  }));

vi.mock('./api', () => ({
  deleteProgram: deleteProgramMock,
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
};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function openDialog(buttonName: string) {
  await act(async () => {
    getButton(buttonName).click();
  });
  const dialog = document.querySelector('[role="alertdialog"]');
  if (dialog === null) throw new TypeError('Missing dialog.');
  return dialog;
}

describe('ProgramEditDangerZoneSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    deleteProgramMock.mockReset();
    getEditableProgramMock.mockReset();
    getEditableProgramMock.mockResolvedValue({ deletionScopeCounts });
    purgeProgramMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('STAFF에게는 삭제 대신 아카이브 안내만 보여주고 두 삭제 버튼을 숨긴다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin={false}
        />,
      );
    });

    expect(container.textContent).toContain('아카이브');
    expect(container.textContent).not.toContain('연결 데이터까지 모두 삭제');
    expect(Array.from(container.querySelectorAll('button'))).toHaveLength(0);
  });

  it('ADMIN에게는 일반 삭제와 전체 삭제 옵션을 모두 보여준다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    expect(getButton('삭제').getAttribute('data-variant')).toBe('destructive');
    expect(
      getButton('연결 데이터까지 모두 삭제').getAttribute('data-variant'),
    ).toBe('destructive');
  });

  it('deletionProtected가 true면 두 삭제 경로와 범위 조회를 막고 한국어 설명을 보여준다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
          deletionProtected
        />,
      );
    });

    expect(container.textContent).toContain('삭제 보호된 프로그램입니다');
    expect(container.textContent).toContain(
      '이 프로그램은 삭제 보호가 설정되어 관리자도 삭제하거나 전체 삭제할 수 없습니다.',
    );
    expect(getButton('삭제').disabled).toBe(true);
    expect(getButton('연결 데이터까지 모두 삭제').disabled).toBe(true);

    await act(async () => {
      getButton('삭제').click();
      getButton('연결 데이터까지 모두 삭제').click();
    });

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(deleteProgramMock).not.toHaveBeenCalled();
    expect(getEditableProgramMock).not.toHaveBeenCalled();
    expect(purgeProgramMock).not.toHaveBeenCalled();
  });

  it('deletionProtected가 false(기본값)면 삭제 버튼 둘 다 활성 상태를 유지한다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    expect(container.textContent).not.toContain('삭제 보호된 프로그램입니다');
    expect(getButton('삭제').disabled).toBe(false);
    expect(getButton('연결 데이터까지 모두 삭제').disabled).toBe(false);
  });

  it('409 차단 사유는 유지하고 전체 삭제 범위는 새로 읽는다', async () => {
    getEditableProgramMock.mockResolvedValue({
      deletionScopeCounts: {
        applications: 6,
        teams: 7,
        boardPosts: 8,
        submissions: 9,
      },
    });
    deleteProgramMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Program has blockers',
        status: 409,
        detail: '',
        code: PROGRAM_DELETE_BLOCKED_CODE,
        instance: '/programs/program-1',
        ...{
          blockingCounts: {
            applications: 2,
            teams: 3,
            boardPosts: 4,
            submissions: 5,
          },
        },
      }),
    );
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    const dialog = await openDialog('삭제');
    const input = document.querySelector<HTMLInputElement>(
      '#program-delete-confirm-name',
    );
    if (input === null) throw new TypeError('Missing confirmation input.');
    await act(async () => setInputValue(input, 'OSS 프로그램'));
    await act(async () => getButton('삭제', dialog).click());
    await act(async () => void (await Promise.resolve()));

    expect(document.body.textContent).toContain(
      '지원서 2건 · 팀 3개 · 게시글 4건 · 제출물 5건',
    );
    expect(
      Array.from(document.querySelectorAll('a')).map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual(
      expect.arrayContaining([
        '/programs/program-1/applicants',
        '/programs/program-1/teams',
        '/programs/program-1/board',
        '/programs/program-1/status',
      ]),
    );

    await act(async () => getButton('취소', dialog).click());
    await openDialog('연결 데이터까지 모두 삭제');
    await act(async () => void (await Promise.resolve()));
    expect(document.body.textContent).toContain(
      '삭제될 데이터: 지원서 6건 · 팀 7개 · 게시글 8건 · 제출물 9건',
    );
    expect(getEditableProgramMock).toHaveBeenCalledWith('program-1');
  });

  it('전체 삭제를 바로 열어도 현재 삭제 범위를 양수 건수로 보여준다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    await openDialog('연결 데이터까지 모두 삭제');
    await act(async () => void (await Promise.resolve()));

    expect(document.body.textContent).toContain(
      '삭제될 데이터: 지원서 2건 · 팀 3개 · 게시글 4건 · 제출물 5건',
    );
  });

  it('전체 삭제를 바로 열어도 현재 삭제 범위를 보여주고 0건을 명시한다', async () => {
    getEditableProgramMock.mockResolvedValue({
      deletionScopeCounts: {
        applications: 0,
        teams: 0,
        boardPosts: 0,
        submissions: 0,
      },
    });
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    await openDialog('연결 데이터까지 모두 삭제');
    await act(async () => void (await Promise.resolve()));

    expect(document.body.textContent).toContain('연결된 데이터 없음');
  });

  it('전체 삭제 범위를 읽는 동안에는 이름이 일치해도 확정 버튼을 비활성으로 유지한다', async () => {
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
          isAdmin
        />,
      );
    });

    const dialog = await openDialog('연결 데이터까지 모두 삭제');
    const input = document.querySelector<HTMLInputElement>(
      '#program-purge-confirm-name',
    );
    if (input === null) throw new TypeError('Missing purge input.');
    await act(async () => setInputValue(input, 'OSS 프로그램'));

    expect(getButton('삭제 범위를 확인하는 중…', dialog).disabled).toBe(true);

    await act(async () => {
      resolveScope?.({ deletionScopeCounts });
      await Promise.resolve();
    });

    expect(getButton('연결 데이터까지 모두 삭제', dialog).disabled).toBe(false);
  });

  it('프로그램 이름이 다르면 전체 삭제 확정 버튼을 비활성으로 유지한다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    const dialog = await openDialog('연결 데이터까지 모두 삭제');
    const input = document.querySelector<HTMLInputElement>(
      '#program-purge-confirm-name',
    );
    if (input === null) throw new TypeError('Missing purge input.');
    await act(async () => setInputValue(input, '다른 프로그램'));

    expect(getButton('연결 데이터까지 모두 삭제', dialog).disabled).toBe(true);
  });

  // TOCTOU(#F2): 확인 화면(getEditableProgram)이 읽은 이후 purge 전에 범위가 바뀌면
  // 백엔드가 409(PRG_014)로 거부한다. 화면은 자동 재시도하지 않고, 응답이 실어 온
  // 현재 카운트로 갱신해 관리자가 이름을 다시 입력해 명시적으로 재확인하게 한다.
  it('purge가 409 범위 변경 응답을 받으면 자동 재시도하지 않고 새 카운트로 이름 재입력을 요구한다', async () => {
    const changedCounts = {
      applications: 6,
      teams: 7,
      boardPosts: 8,
      submissions: 9,
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
          isAdmin
        />,
      );
    });

    const dialog = await openDialog('연결 데이터까지 모두 삭제');
    await act(async () => void (await Promise.resolve()));
    const input = document.querySelector<HTMLInputElement>(
      '#program-purge-confirm-name',
    );
    if (input === null) throw new TypeError('Missing purge input.');
    await act(async () => setInputValue(input, 'OSS 프로그램'));
    await act(async () =>
      getButton('연결 데이터까지 모두 삭제', dialog).click(),
    );
    await act(async () => void (await Promise.resolve()));

    // 화면이 마지막으로 보여준 카운트(deletionScopeCounts)를 그대로 expectedScope로 보낸다 —
    // 별도 재확인 GET 없이 딱 한 번만 purge를 호출했다.
    expect(purgeProgramMock).toHaveBeenCalledTimes(1);
    expect(purgeProgramMock).toHaveBeenCalledWith(
      'program-1',
      deletionScopeCounts,
    );
    expect(input.value).toBe('');
    expect(document.body.textContent).toContain(
      '삭제 범위가 변경되었습니다. 내용을 확인한 뒤 프로그램 이름을 다시 입력해 주세요.',
    );
    expect(document.body.textContent).toContain(
      '삭제될 데이터: 지원서 6건 · 팀 7개 · 게시글 8건 · 제출물 9건',
    );

    // 이름을 다시 입력해 명시적으로 재확인하면, 갱신된 카운트를 expectedScope로 보내
    // 이번엔 성공한다 — 자동 재시도가 아니라 관리자의 새 확인이다.
    purgeProgramMock.mockResolvedValueOnce({
      id: 'program-1',
      deleted: true,
      deletedCounts: { applications: 6 },
    });
    await act(async () => setInputValue(input, 'OSS 프로그램'));
    await act(async () =>
      getButton('연결 데이터까지 모두 삭제', dialog).click(),
    );
    await act(async () => void (await Promise.resolve()));

    expect(purgeProgramMock).toHaveBeenCalledTimes(2);
    expect(purgeProgramMock).toHaveBeenLastCalledWith(
      'program-1',
      changedCounts,
    );
  });

  it('전체 삭제 성공 후 즉시 목록 확인으로 이동해 삭제된 프로그램 화면을 남기지 않는다', async () => {
    purgeProgramMock.mockResolvedValue({
      id: 'program-1',
      deleted: true,
      deletedCounts: { applications: 2, notifications: 3, boardPosts: 0 },
    });
    function PurgeNavigationHarness() {
      const [notice, setNotice] = useState<string | null>(null);
      if (notice !== null) return <p>{notice}</p>;
      return (
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
          onDeleted={(nextNotice) => setNotice(nextNotice ?? '')}
        />
      );
    }
    await act(async () => {
      root.render(<PurgeNavigationHarness />);
    });

    const dialog = await openDialog('연결 데이터까지 모두 삭제');
    const input = document.querySelector<HTMLInputElement>(
      '#program-purge-confirm-name',
    );
    if (input === null) throw new TypeError('Missing purge input.');
    await act(async () => setInputValue(input, 'OSS 프로그램'));
    await act(async () =>
      getButton('연결 데이터까지 모두 삭제', dialog).click(),
    );
    await act(async () => void (await Promise.resolve()));

    expect(purgeProgramMock).toHaveBeenCalledWith(
      'program-1',
      deletionScopeCounts,
    );
    expect(container.querySelector('section')).toBeNull();
    expect(container.textContent).toContain('지원서 2건 · 알림 3건');
  });

  it('전체 삭제가 403이면 오류를 화면에 보여준다', async () => {
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
          isAdmin
        />,
      );
    });

    const dialog = await openDialog('연결 데이터까지 모두 삭제');
    const input = document.querySelector<HTMLInputElement>(
      '#program-purge-confirm-name',
    );
    if (input === null) throw new TypeError('Missing purge input.');
    await act(async () => setInputValue(input, 'OSS 프로그램'));
    await act(async () =>
      getButton('연결 데이터까지 모두 삭제', dialog).click(),
    );
    await act(async () => void (await Promise.resolve()));

    expect(document.body.textContent).toContain('전체 삭제 권한이 없습니다.');
  });
});
