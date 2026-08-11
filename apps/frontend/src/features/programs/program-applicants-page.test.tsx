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

  it('목록 제목 칸도 학생이 넣은 Bidi 를 흘리지 않는다', async () => {
    // 목록은 `line-clamp-2` 로 잘라 그리지만 잘라도 방향은 뒤집힌다(#735).
    listProgramApplicationsMock.mockResolvedValue(
      applicationPage([
        {
          ...personal,
          answers: { ...personal.answers, title: '제목\u202E뒤집기' },
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
    expect(container.textContent).toContain('제목뒤집기');
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
