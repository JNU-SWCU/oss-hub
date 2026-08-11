// @vitest-environment happy-dom

import { act } from 'react';
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

const { deleteProgramMock } = vi.hoisted(() => ({
  deleteProgramMock: vi.fn(),
}));

vi.mock('./api', () => ({
  deleteProgram: deleteProgramMock,
}));

import { ProgramEditDangerZoneSection } from './program-edit-danger-zone-section';

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

function queryButton(name: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;
}

// #875 — ADMIN 전용 위험 영역(영구 삭제). STAFF에게는 섹션 자체가 보이지 않아야 하고,
// 삭제는 프로그램 이름을 정확히 입력해야 확정되며, 409는 카테고리별로 다른 문구를 보여준다.
describe('ProgramEditDangerZoneSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    deleteProgramMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('STAFF(isAdmin=false)에게는 아무것도 그리지 않는다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin={false}
        />,
      );
    });

    expect(container.textContent).toBe('');
    expect(container.querySelector('section')).toBeNull();
  });

  it('ADMIN에게는 위험 영역과 destructive 톤의 삭제 버튼을 보여준다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    expect(container.textContent).toContain('위험 영역');
    const deleteButton = getButton('삭제');
    expect(deleteButton.getAttribute('data-variant')).toBe('destructive');
  });

  it('삭제 버튼을 누르면 확인 다이얼로그가 뜨고, 이름을 정확히 입력해야 확정 버튼이 풀린다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    await act(async () => {
      getButton('삭제').click();
    });

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    const confirmInput = document.querySelector<HTMLInputElement>(
      '#program-delete-confirm-name',
    );
    if (confirmInput === null) throw new TypeError('Missing confirm input.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;

    // 다이얼로그가 열린 시점엔 두 개의 「삭제」 버튼(취소 옆 확정 버튼 포함)이
    // 있으니, disabled 상태의 그 버튼을 다이얼로그 안에서 찾는다.
    const dialog = document.querySelector('[role="alertdialog"]');
    const confirmButton = Array.from(
      dialog?.querySelectorAll('button') ?? [],
    ).find((candidate) => candidate.textContent?.trim() === '삭제');
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new TypeError('Missing confirm delete button.');
    }
    expect(confirmButton.disabled).toBe(true);

    await act(async () => {
      setter?.call(confirmInput, '틀린 이름');
      confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(confirmButton.disabled).toBe(true);

    await act(async () => {
      setter?.call(confirmInput, 'OSS 프로그램');
      confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(confirmButton.disabled).toBe(false);
  });

  it('취소를 누르면 다이얼로그가 닫히고 API를 호출하지 않는다', async () => {
    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    await act(async () => {
      getButton('삭제').click();
    });
    await act(async () => {
      getButton('취소').click();
    });

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(deleteProgramMock).not.toHaveBeenCalled();
  });

  it('확정하면 deleteProgram을 호출하고 성공 시 onDeleted를 부른다', async () => {
    deleteProgramMock.mockResolvedValue({ id: 'program-1', deleted: true });
    const onDeleted = vi.fn();

    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
          onDeleted={onDeleted}
        />,
      );
    });

    await act(async () => {
      getButton('삭제').click();
    });
    const confirmInput = document.querySelector<HTMLInputElement>(
      '#program-delete-confirm-name',
    );
    if (confirmInput === null) throw new TypeError('Missing confirm input.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(confirmInput, 'OSS 프로그램');
      confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const dialog = document.querySelector('[role="alertdialog"]');
    const confirmButton = Array.from(
      dialog?.querySelectorAll('button') ?? [],
    ).find((candidate) => candidate.textContent?.trim() === '삭제');
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new TypeError('Missing confirm delete button.');
    }

    await act(async () => {
      confirmButton.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteProgramMock).toHaveBeenCalledWith('program-1');
    expect(onDeleted).toHaveBeenCalled();
  });

  it('boardPosts 409는 게시판 이동 링크가 있는 문구를 보여준다', async () => {
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
            applications: 0,
            teams: 0,
            submissions: 0,
            boardPosts: 2,
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

    await act(async () => {
      getButton('삭제').click();
    });
    const confirmInput = document.querySelector<HTMLInputElement>(
      '#program-delete-confirm-name',
    );
    if (confirmInput === null) throw new TypeError('Missing confirm input.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(confirmInput, 'OSS 프로그램');
      confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const dialog = document.querySelector('[role="alertdialog"]');
    const confirmButton = Array.from(
      dialog?.querySelectorAll('button') ?? [],
    ).find((candidate) => candidate.textContent?.trim() === '삭제');
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new TypeError('Missing confirm delete button.');
    }

    await act(async () => {
      confirmButton.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      '게시글 2개가 남아 있습니다. 게시판에서 지운 뒤 다시 시도하세요.',
    );
    const boardLink = Array.from(document.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === '게시판으로 이동',
    );
    expect(boardLink).toBeTruthy();
    // 다이얼로그는 실패 후에도 열린 채 남는다 — 다시 시도하거나 취소할 수 있어야 한다.
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('applications/teams 409는 사실만 말하고 다음 행동(링크)은 주지 않는다', async () => {
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
            applications: 4,
            teams: 1,
            submissions: 0,
            boardPosts: 0,
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

    await act(async () => {
      getButton('삭제').click();
    });
    const confirmInput = document.querySelector<HTMLInputElement>(
      '#program-delete-confirm-name',
    );
    if (confirmInput === null) throw new TypeError('Missing confirm input.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(confirmInput, 'OSS 프로그램');
      confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const dialog = document.querySelector('[role="alertdialog"]');
    const confirmButton = Array.from(
      dialog?.querySelectorAll('button') ?? [],
    ).find((candidate) => candidate.textContent?.trim() === '삭제');
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new TypeError('Missing confirm delete button.');
    }

    await act(async () => {
      confirmButton.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      '신청 4건 / 팀 1개가 남아 있습니다. 학생 데이터가 있는 프로그램은 지울 수 없습니다.',
    );
    expect(queryButton('게시판으로 이동')).toBeUndefined();
    expect(
      Array.from(document.querySelectorAll('a')).some(
        (link) => link.textContent?.trim() === '게시판으로 이동',
      ),
    ).toBe(false);
  });

  it('일반 실패(네트워크 오류 등)는 일반 실패 메시지를 보여준다', async () => {
    deleteProgramMock.mockRejectedValue(new TypeError('network'));

    await act(async () => {
      root.render(
        <ProgramEditDangerZoneSection
          programId="program-1"
          programName="OSS 프로그램"
          isAdmin
        />,
      );
    });

    await act(async () => {
      getButton('삭제').click();
    });
    const confirmInput = document.querySelector<HTMLInputElement>(
      '#program-delete-confirm-name',
    );
    if (confirmInput === null) throw new TypeError('Missing confirm input.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(confirmInput, 'OSS 프로그램');
      confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const dialog = document.querySelector('[role="alertdialog"]');
    const confirmButton = Array.from(
      dialog?.querySelectorAll('button') ?? [],
    ).find((candidate) => candidate.textContent?.trim() === '삭제');
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new TypeError('Missing confirm delete button.');
    }

    await act(async () => {
      confirmButton.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      '프로그램을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  });
});
