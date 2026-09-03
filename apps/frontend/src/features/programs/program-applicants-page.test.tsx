// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApplicationListRequestEpoch,
  ProgramApplicantsPage,
} from './program-applicants-page';
import { programApplicationDetailHref } from '@/lib/program-route';
import type {
  ApplicationListItem,
  ApplicationListPage,
  ProgramDetail,
} from './types';

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

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: pushMock }),
}));

const { getProgramDetailMock, listProgramApplicationsMock } = vi.hoisted(
  () => ({
    getProgramDetailMock: vi.fn(),
    listProgramApplicationsMock: vi.fn(),
  }),
);

vi.mock('./api', () => ({
  getProgramDetail: getProgramDetailMock,
  listProgramApplications: listProgramApplicationsMock,
}));

function participationLabel(item: ApplicationListItem): string {
  if (item.team) {
    return `${item.team.name} (${item.team.memberCount}명)`;
  }
  return '1명';
}

const personal: ApplicationListItem = {
  id: 'app-personal',
  programId: 'program-1',
  repositoryConnectionMode: 'NEW',
  repositoryUrl: null,
  status: 'SUBMITTED',
  rejectionReason: null,
  repositoryProvisioning: {
    enabled: true,
    jobStatus: 'PENDING',
    updatedAt: '2026-07-15T00:00:00.000Z',
    safeErrorClass: null,
  },
  isRepositoryPublicationPlanned: true,
  repository: null,
  submittedAt: '2026-07-15T00:00:00.000Z',
  participation: 'INDIVIDUAL',
  applicant: {
    id: 'student-1',
    name: '합성 학생',
    nickname: 'login-1',
  },
  team: null,
  answers: {
    applicantName: '합성 학생',
    title: '개인 제목',
    summary: '요약',
  },
};

const team: ApplicationListItem = {
  id: 'app-team',
  programId: 'program-1',
  repositoryConnectionMode: 'NEW',
  repositoryUrl: null,
  status: 'APPROVED',
  rejectionReason: null,
  repositoryProvisioning: {
    enabled: true,
    jobStatus: 'SUCCEEDED',
    updatedAt: '2026-07-16T00:00:00.000Z',
    safeErrorClass: null,
  },
  isRepositoryPublicationPlanned: false,
  repository: null,
  submittedAt: '2026-07-16T00:00:00.000Z',
  participation: 'TEAM',
  applicant: {
    id: 'student-2',
    name: '팀장',
    nickname: 'leader',
  },
  team: { id: 'team-1', name: '합성 팀', memberCount: 3 },
  answers: {
    applicantName: '팀장',
    title: '팀 제목',
    summary: '팀 요약',
  },
};

const rejected: ApplicationListItem = {
  ...team,
  id: 'app-rejected',
  programId: 'program-1',
  repositoryConnectionMode: 'NEW',
  repositoryUrl: null,
  status: 'REJECTED',
  rejectionReason: '합성 반려 사유',
  repositoryProvisioning: {
    enabled: false,
    jobStatus: 'DISABLED',
    updatedAt: '2026-07-16T00:00:00.000Z',
    safeErrorClass: null,
  },
  answers: {
    applicantName: '반려 학생',
    title: '반려된 신청',
    summary: '반려 요약',
  },
  applicant: {
    id: 'student-3',
    name: '반려 학생',
    nickname: 'rejected-user',
  },
  team: null,
  participation: 'INDIVIDUAL',
};

const program: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 주관',
  category: 'BASIC',
  description: '설명',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-08-01T00:00:00.000Z',
  },
  viewer: { role: 'STAFF', applicationStatus: null },
  milestones: [],
};

function applicationPage(
  items: readonly ApplicationListItem[],
): ApplicationListPage {
  return {
    items,
    page: 1,
    pageSize: 20,
    totalItems: items.length,
    totalPages: 1,
  };
}

function queryButton(name: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('program applicants display helpers', () => {
  it('팀이 없으면 인원만 표시한다', () => {
    expect(participationLabel(personal)).toBe('1명');
  });

  it('팀이 있으면 팀명과 인원을 표시한다', () => {
    expect(participationLabel(team)).toBe('합성 팀 (3명)');
  });

  it('상세 href 는 locked #119 경로를 쓴다', () => {
    expect(programApplicationDetailHref('program:1', 'app:2')).toBe(
      '/programs/program%3A1/applications/app%3A2',
    );
  });
});

describe('application list request epoch', () => {
  it('오래된 poll 응답이 더 최신 authoritative reload를 덮어쓰지 않는다', async () => {
    const requestEpoch = new ApplicationListRequestEpoch();
    const pollResponse = deferred<string>();
    const authoritativeResponse = deferred<string>();
    let visibleList = 'initial';

    const commitResponse = async (response: Promise<string>) => {
      const epoch = requestEpoch.begin();
      const list = await response;
      if (requestEpoch.isCurrent(epoch)) visibleList = list;
    };

    const poll = commitResponse(pollResponse.promise);
    const authoritativeReload = commitResponse(authoritativeResponse.promise);

    authoritativeResponse.resolve('authoritative');
    await authoritativeReload;
    pollResponse.resolve('stale poll');
    await poll;

    expect(visibleList).toBe('authoritative');
  });
});

describe('programApplicationDetailHref in markup', () => {
  it('행 링크가 인코딩된 상세 경로를 가리킨다', () => {
    const href = programApplicationDetailHref('program-1', 'app-1');
    const html = renderToStaticMarkup(<a href={href}>보기</a>);
    expect(html).toContain('/programs/program-1/applications/app-1');
    expect(html).not.toContain('판정');
  });
});

describe('program applicants review flow', () => {
  // [#869] 판정(승인/반려/되돌리기)은 신청 상세에서만 한다 — 목록 행은 그리로
  // 보내는 안내와 링크만 그린다. 이 describe 는 그 계약을 검증한다.
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    getProgramDetailMock.mockReset();
    listProgramApplicationsMock.mockReset();
    pushMock.mockReset();
    getProgramDetailMock.mockResolvedValue(program);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('행에는 승인·반려·되돌리기 버튼이 없다', async () => {
    listProgramApplicationsMock.mockResolvedValue(
      applicationPage([personal, team, rejected]),
    );

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(queryButton('승인')).toBeUndefined();
    expect(queryButton('반려')).toBeUndefined();
    expect(queryButton('되돌리기')).toBeUndefined();
  });

  it('SUBMITTED 행은 「검토 대기」로 보이고 「검토하기」 링크가 신청 상세를 가리킨다', async () => {
    listProgramApplicationsMock.mockResolvedValue(applicationPage([personal]));

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('검토 대기');
    const link = Array.from(container.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === '검토하기',
    );
    expect(link?.getAttribute('href')).toBe(
      programApplicationDetailHref('program-1', personal.id),
    );
  });

  it('행을 클릭하면(링크 밖) 그 신청 상세로 이동한다', async () => {
    listProgramApplicationsMock.mockResolvedValue(applicationPage([personal]));

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const row = container.querySelector('tbody tr');
    expect(row).not.toBeNull();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(pushMock).toHaveBeenCalledWith(
      programApplicationDetailHref('program-1', personal.id),
    );
  });

  it('행 안 「검토하기」 링크를 클릭하면 행 클릭과 겹쳐 중복 이동시키지 않는다', async () => {
    listProgramApplicationsMock.mockResolvedValue(applicationPage([personal]));

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const link = Array.from(container.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === '검토하기',
    );
    expect(link).toBeTruthy();
    await act(async () => {
      link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 링크 자신이 이동을 처리하므로, 버블링된 행 클릭이 한 번 더 push 하지 않는다.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('제거된 신청 제목을 목록 칸이나 값으로 다시 노출하지 않는다', async () => {
    listProgramApplicationsMock.mockResolvedValue(
      applicationPage([
        {
          ...personal,
          answers: { ...personal.answers, title: '노출되면 안 되는 제목' },
        },
      ]),
    );

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const headers = Array.from(container.querySelectorAll('th')).map((header) =>
      header.textContent?.trim(),
    );
    const searchInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="신청자 검색"]',
    );
    expect(headers).not.toContain('제목');
    expect(searchInput?.placeholder).toBe('이름·팀·GitHub');
    expect(container.textContent).not.toContain('노출되면 안 되는 제목');
  });

  it('목록의 신청자·핸들 칸도 Bidi 를 흘리지 않는다', async () => {
    // 프로필 이름과 GitHub 핸들 둘 다 표시되는 칸이다.
    listProgramApplicationsMock.mockResolvedValue(
      applicationPage([
        {
          ...personal,
          answers: { ...personal.answers, applicantName: '' },
          applicant: {
            id: 'student-1',
            name: '계정\u202E이름',
            nickname: 'login\u202E1',
          },
        },
      ]),
    );

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('\u202E');
    expect(container.textContent).toContain('계정이름');
    expect(container.textContent).toContain('@login1');
  });
});

describe('program applicants search input', () => {
  // [#1094] 검색어를 치는 동안 표와 검색창이 자리를 지켜야 한다. 한 글자마다 화면을
  // 스켈레톤으로 갈아치우면 검색창이 새로 그려져 초점이 사라지고, 그 사이 누른 글자는
  // 어디에도 들어가지 않는다. 이 describe 는 그 계약을 검증한다.
  /** 화면의 debounce 보다 넉넉히 잡는다 — 검색어가 조회 조건에 반영될 시간을 준다. */
  const SEARCH_SETTLE_MS = 1_000;
  const SKELETON_SELECTOR = '[aria-label="신청자 목록 불러오는 중"]';
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    getProgramDetailMock.mockReset();
    listProgramApplicationsMock.mockReset();
    pushMock.mockReset();
    getProgramDetailMock.mockResolvedValue(program);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function searchBox(): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>(
      'input[aria-label="신청자 검색"]',
    );
  }

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function typeInto(
    input: HTMLInputElement,
    character: string,
  ): Promise<void> {
    await act(async () => {
      nativeInputValueSetter?.call(input, `${input.value}${character}`);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  /**
   * 사람은 **화면에 있는, 초점이 있는 곳**에 친다. 검색창이 걷혀 나갔으면 그 글자는
   * 어디에도 들어가지 않는다 — 이 티켓이 말하는 「조용히 사라지는 글자」다.
   */
  async function typeWhereFocused(character: string): Promise<void> {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement) || !container.contains(active))
      return;
    await typeInto(active, character);
  }

  async function settle(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_SETTLE_MS);
    });
    await flush();
  }

  async function renderReady(): Promise<void> {
    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await flush();
  }

  function busyRegion(): Element | null {
    return container.querySelector('[aria-busy]');
  }

  async function submitSearch(): Promise<void> {
    const form = container.querySelector('form');
    if (form === null) throw new TypeError('검색 폼을 찾지 못했습니다.');
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    await flush();
  }

  it('세 글자를 이어서 치면 중간에 검색창을 다시 클릭하지 않아도 모두 들어간다', async () => {
    // 저장소 발급이 끝난 행만 둔다 — 폴링 타이머가 조회 횟수에 끼어들지 않게 한다.
    listProgramApplicationsMock.mockResolvedValueOnce(applicationPage([team]));
    await renderReady();

    // 첫 글자 뒤에 나갈 조회는 응답을 붙들어 둔다. 사람은 응답을 기다렸다가 다음
    // 글자를 치지 않는다 — 세 글자는 조회가 매달려 있는 동안 연달아 들어온다.
    listProgramApplicationsMock.mockReturnValue(
      deferred<ApplicationListPage>().promise,
    );

    const input = searchBox();
    if (input === null) throw new TypeError('검색창을 찾지 못했습니다.');
    input.focus();

    for (const character of ['김', '민', '수']) {
      await typeWhereFocused(character);
    }

    expect(searchBox()?.value).toBe('김민수');
    expect(document.activeElement).toBe(searchBox());
  });

  it('세 글자를 치는 동안 목록 조회가 글자마다 나가지 않고 프로그램 상세는 다시 부르지 않는다', async () => {
    listProgramApplicationsMock.mockResolvedValue(applicationPage([team]));
    await renderReady();

    expect(listProgramApplicationsMock).toHaveBeenCalledTimes(1);
    expect(getProgramDetailMock).toHaveBeenCalledTimes(1);

    for (const character of ['김', '민', '수']) {
      // 화면이 걷혔다 다시 그려지는 경우까지 봐준다 — 검색창을 다시 클릭하는 셈이다.
      await flush();
      const input = searchBox();
      if (input === null)
        throw new TypeError('검색창이 화면에서 사라졌습니다.');
      await typeInto(input, character);
    }
    await settle();

    expect(searchBox()?.value).toBe('김민수');
    expect(listProgramApplicationsMock).toHaveBeenCalledTimes(2);
    expect(getProgramDetailMock).toHaveBeenCalledTimes(1);
  });

  it('조회가 끝나기 전에도 스켈레톤이 화면을 덮지 않고 검색창이 초점을 지킨다', async () => {
    listProgramApplicationsMock.mockResolvedValueOnce(applicationPage([team]));
    await renderReady();

    const pending = deferred<ApplicationListPage>();
    listProgramApplicationsMock.mockReturnValueOnce(pending.promise);

    const input = searchBox();
    if (input === null) throw new TypeError('검색창을 찾지 못했습니다.');
    input.focus();
    await typeInto(input, '김');
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_SETTLE_MS);
    });

    expect(document.querySelector(SKELETON_SELECTOR)).toBeNull();
    expect(searchBox()).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('김');
    // 응답을 기다리는 동안에도 이미 그려진 표는 자리를 지킨다.
    expect(container.querySelector('tbody tr')).not.toBeNull();

    pending.resolve(applicationPage([team]));
    await flush();
  });

  it('저장소 발급을 기다리는 행이 있어도 검색 결과가 표에 닿는다', async () => {
    // 폴링이 도는 화면에서도 검색을 시작하며 기존 표를 스켈레톤으로 갈아치우지 않고,
    // 사용자가 요청한 결과를 같은 표에 반영한다.
    listProgramApplicationsMock.mockResolvedValueOnce(
      applicationPage([personal]),
    );
    await renderReady();
    expect(container.textContent).toContain('합성 학생');

    listProgramApplicationsMock.mockResolvedValue(applicationPage([rejected]));
    const input = searchBox();
    if (input === null) throw new TypeError('검색창을 찾지 못했습니다.');
    await typeInto(input, '반');
    await settle();

    expect(document.querySelector(SKELETON_SELECTOR)).toBeNull();
    expect(container.textContent).toContain('반려 학생');
  });

  it('검색 조회 중에는 폴링 시각이 지나도 검색 결과의 순서를 빼앗지 않는다', async () => {
    listProgramApplicationsMock.mockResolvedValueOnce(
      applicationPage([personal]),
    );
    await renderReady();

    const foreground = deferred<ApplicationListPage>();
    listProgramApplicationsMock
      .mockReturnValueOnce(foreground.promise)
      .mockRejectedValueOnce(new TypeError('합성 폴링 실패'));

    const input = searchBox();
    if (input === null) throw new TypeError('검색창을 찾지 못했습니다.');
    await typeInto(input, '반');
    await settle();

    expect(busyRegion()?.getAttribute('aria-busy')).toBe('true');
    expect(listProgramApplicationsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    await flush();

    foreground.resolve(applicationPage([rejected]));
    await flush();

    expect(listProgramApplicationsMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('반려 학생');
  });

  it('이전 검색 응답이 끝나도 최신 검색 중인 표는 계속 바쁨으로 알린다', async () => {
    listProgramApplicationsMock.mockResolvedValueOnce(applicationPage([team]));
    await renderReady();

    const firstSearch = deferred<ApplicationListPage>();
    const latestSearch = deferred<ApplicationListPage>();
    listProgramApplicationsMock
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(latestSearch.promise);

    const input = searchBox();
    if (input === null) throw new TypeError('검색창을 찾지 못했습니다.');
    await typeInto(input, '김');
    await submitSearch();
    await typeInto(input, '민');
    await submitSearch();

    expect(listProgramApplicationsMock).toHaveBeenCalledTimes(3);
    expect(busyRegion()?.getAttribute('aria-busy')).toBe('true');

    firstSearch.resolve(applicationPage([personal]));
    await flush();

    expect(busyRegion()?.getAttribute('aria-busy')).toBe('true');

    latestSearch.resolve(applicationPage([rejected]));
    await flush();

    expect(busyRegion()?.getAttribute('aria-busy')).toBe('false');
    expect(container.textContent).toContain('반려 학생');
  });

  it('자동 새로고침 대상 프로그램에서 다른 프로그램으로 이동해도 새 목록을 보여 준다', async () => {
    const nextProgram: ProgramDetail = {
      ...program,
      id: 'program-2',
      name: '두 번째 프로그램',
    };
    const nextApplication: ApplicationListItem = {
      ...team,
      id: 'app-program-2',
      programId: nextProgram.id,
      applicant: {
        id: 'student-program-2',
        name: '두 번째 학생',
        nickname: 'second-student',
      },
      answers: {
        applicantName: '두 번째 학생',
        title: '두 번째 신청',
        summary: '두 번째 요약',
      },
    };
    const nextApplications = deferred<ApplicationListPage>();
    getProgramDetailMock
      .mockResolvedValueOnce(program)
      .mockResolvedValueOnce(nextProgram);
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([personal]))
      .mockReturnValueOnce(nextApplications.promise);
    await renderReady();

    await act(async () => {
      root.render(<ProgramApplicantsPage programId={nextProgram.id} />);
    });
    await flush();
    expect(document.querySelector(SKELETON_SELECTOR)).not.toBeNull();

    nextApplications.resolve(applicationPage([nextApplication]));
    await flush();

    expect(document.querySelector(SKELETON_SELECTOR)).toBeNull();
    expect(container.textContent).toContain('두 번째 프로그램 신청자');
    expect(container.textContent).toContain('두 번째 학생');
    expect(busyRegion()?.getAttribute('aria-busy')).toBe('false');
  });
});
