// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramStaffTeamsPage } from './program-staff-teams-page';
import { APPLICATION_STATUS_LABELS } from './application-presentation';
import type {
  ApplicationStatus,
  TeamManagementListItem,
  TeamManagementListPage,
} from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const {
  listTeamManagementApplicationsMock,
  decideApplicationMock,
  getApplicationDetailMock,
} = vi.hoisted(() => ({
  listTeamManagementApplicationsMock: vi.fn(),
  decideApplicationMock: vi.fn(),
  getApplicationDetailMock: vi.fn(),
}));

vi.mock('./api', () => ({
  listTeamManagementApplications: listTeamManagementApplicationsMock,
  decideApplication: decideApplicationMock,
  getApplicationDetail: getApplicationDetailMock,
}));

const PROGRAM_ID = 'program-1';

function item(
  id: string,
  status: ApplicationStatus,
  overrides: Partial<TeamManagementListItem> = {},
): TeamManagementListItem {
  return {
    id,
    programId: PROGRAM_ID,
    status,
    submittedAt: '2026-08-05T05:32:00.000Z',
    rejectionReason: null,
    applicant: {
      id: `${id}-applicant`,
      name: '합성 신청자',
      nickname: `applicant-${id}`,
    },
    team: {
      id: `${id}-team`,
      name: `합성 팀 ${id}`,
      memberCount: 2,
      members: [
        { id: 'm1', name: '가나다', nickname: 'login-a' },
        { id: 'm2', name: null, nickname: 'login-b' },
      ],
    },
    ...overrides,
  };
}

function page(
  items: readonly TeamManagementListItem[],
  overrides: Partial<TeamManagementListPage> = {},
): TeamManagementListPage {
  return {
    items,
    page: 1,
    pageSize: 20,
    totalItems: items.length,
    totalPages: 1,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root.render(<ProgramStaffTeamsPage programId={PROGRAM_ID} />);
  });
}

function statusSelects(): HTMLSelectElement[] {
  return [...container.querySelectorAll('select')];
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  listTeamManagementApplicationsMock.mockResolvedValue(
    page([item('a', 'SUBMITTED')]),
  );
  decideApplicationMock.mockResolvedValue({});
  getApplicationDetailMock.mockResolvedValue({ id: 'a' });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('ProgramStaffTeamsPage — 서버가 주는 순서와 페이지', () => {
  it('lean projection 을 서버 페이지네이션으로 한 번만 읽는다', async () => {
    await mount();

    // 예전에는 신청을 20페이지까지 긁어 팀에 붙였다. 지금은 한 번이다.
    expect(listTeamManagementApplicationsMock).toHaveBeenCalledTimes(1);
    expect(listTeamManagementApplicationsMock).toHaveBeenCalledWith(
      PROGRAM_ID,
      { page: 1, pageSize: 20, search: '', status: 'all' },
    );
  });

  it('서버가 준 순서를 그대로 렌더한다 — 클라이언트가 다시 정렬하지 않는다', async () => {
    // Given: 서버가 검토대기 우선으로 이미 정렬해 줬다.
    listTeamManagementApplicationsMock.mockResolvedValue(
      page([
        item('b', 'SUBMITTED', {
          team: {
            id: 'team-b',
            name: '나중에 낸 팀',
            memberCount: 1,
            members: [{ id: 'm', name: '나', nickname: 'n' }],
          },
        }),
        item('a', 'APPROVED', {
          team: {
            id: 'team-a',
            name: '먼저 낸 팀',
            memberCount: 1,
            members: [{ id: 'm', name: '가', nickname: 'g' }],
          },
        }),
      ]),
    );

    await mount();

    const text = container.textContent ?? '';
    expect(text.indexOf('나중에 낸 팀')).toBeLessThan(
      text.indexOf('먼저 낸 팀'),
    );
  });

  it('「신청 없음」 칩이 없다 — 팀은 신청이 만들므로 그 상태가 생기지 않는다', async () => {
    await mount();

    expect(container.textContent).not.toContain('신청 없음');
  });

  it('저장소 어휘를 그리지 않는다', async () => {
    await mount();

    for (const forbidden of ['저장소', '발급', '프로비저닝']) {
      expect(container.textContent).not.toContain(forbidden);
    }
  });

  it('「일부만 불러왔습니다」 잘림 안내가 없다 — 더 이상 전량 수집하지 않는다', async () => {
    await mount();

    expect(container.textContent).not.toContain('일부만');
  });
});

describe('ProgramStaffTeamsPage — 상태 드롭다운(AC-14)', () => {
  it.each(['SUBMITTED', 'APPROVED', 'REJECTED'] as const)(
    '%s 에서도 세 옵션이 전부 활성이다',
    async (status) => {
      // Given
      listTeamManagementApplicationsMock.mockResolvedValue(
        page([item('a', status)]),
      );

      // When
      await mount();

      // Then: 어느 출발점에서도 고를 수 없는 옵션이 없다.
      const select = statusSelects()[0];
      expect(select?.value).toBe(status);
      const options = [...(select?.options ?? [])];
      expect(options.map((option) => option.value)).toEqual([
        'SUBMITTED',
        'APPROVED',
        'REJECTED',
      ]);
      expect(options.every((option) => !option.disabled)).toBe(true);
      expect(select?.disabled).toBe(false);
    },
  );
  it('현재 상태를 드롭다운 하나로만 보여 주고 배지를 따로 두지 않는다', async () => {
    await mount();

    const select = statusSelects()[0];
    expect(select?.value).toBe('SUBMITTED');
    expect(select?.getAttribute('data-variant')).toBe('pending');
    expect(select?.className).toContain('bg-status-pending-bg');
    expect(
      container.querySelectorAll('[data-slot="status-badge"]').length,
    ).toBe(0);
    expect(statusSelects()).toHaveLength(1);
  });

  it('승인으로 바꾸면 판정하고 그 행을 다시 읽는다', async () => {
    await mount();

    const select = statusSelects()[0];
    await act(async () => {
      if (select) {
        select.value = 'APPROVED';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(decideApplicationMock).toHaveBeenCalledWith('a', {
      action: 'APPROVE',
    });
    // f-row-decision-refresh — 응답 바디가 아니라 재조회가 행 상태를 준다.
    expect(getApplicationDetailMock).toHaveBeenCalledWith('a');
  });

  it('검토대기로 되돌리면 REVERT 로 보낸다', async () => {
    listTeamManagementApplicationsMock.mockResolvedValue(
      page([item('a', 'APPROVED')]),
    );
    await mount();

    const select = statusSelects()[0];
    await act(async () => {
      if (select) {
        select.value = 'SUBMITTED';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(decideApplicationMock).toHaveBeenCalledWith('a', {
      action: 'REVERT',
    });
  });

  it('반려는 사유 없이 바로 보내지 않고 확인창을 연다', async () => {
    await mount();

    const select = statusSelects()[0];
    await act(async () => {
      if (select) {
        select.value = 'REJECTED';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(decideApplicationMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      APPLICATION_STATUS_LABELS.REJECTED,
    );
  });

  it('같은 상태를 다시 고르면 아무 요청도 보내지 않는다', async () => {
    await mount();

    const select = statusSelects()[0];
    await act(async () => {
      if (select) {
        select.value = 'SUBMITTED';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(decideApplicationMock).not.toHaveBeenCalled();
  });
});

describe('ProgramStaffTeamsPage — 재조회 4분기(AC-16)', () => {
  it('재조회가 실패하면 확인 불가를 알리고 그 행의 다음 판정을 막는다', async () => {
    getApplicationDetailMock.mockRejectedValue(new TypeError('network'));
    await mount();

    const select = statusSelects()[0];
    await act(async () => {
      if (select) {
        select.value = 'APPROVED';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(container.textContent).toContain('확인하지 못했습니다');
    expect(statusSelects()[0]?.disabled).toBe(true);
  });

  it('판정이 실패해도 재조회가 성공하면 행을 막지 않는다', async () => {
    decideApplicationMock.mockRejectedValue(new TypeError('network'));
    await mount();

    const select = statusSelects()[0];
    await act(async () => {
      if (select) {
        select.value = 'APPROVED';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(getApplicationDetailMock).toHaveBeenCalled();
    expect(statusSelects()[0]?.disabled).toBe(false);
  });
});

describe('ProgramStaffTeamsPage — 빈 화면과 실패', () => {
  it('조건 없이 비면 아직 신청이 없다고 말한다', async () => {
    listTeamManagementApplicationsMock.mockResolvedValue(page([]));
    await mount();

    expect(container.textContent).toContain('아직 신청한 팀이 없습니다');
  });

  it('불러오기에 실패하면 다시 시도할 것을 준다', async () => {
    listTeamManagementApplicationsMock.mockRejectedValue(
      new TypeError('network'),
    );
    await mount();

    expect(container.textContent).toContain('불러오지 못했습니다');
    expect(container.textContent).toContain('다시 시도');
  });
});
