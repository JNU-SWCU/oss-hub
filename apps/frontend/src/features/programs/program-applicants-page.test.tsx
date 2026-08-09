// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import {
  ApplicationListRequestEpoch,
  ProgramApplicantsPage,
} from './program-applicants-page';
import { staleApplicationDecisionTitle } from './application-presentation';
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const {
  decideApplicationMock,
  getProgramDetailMock,
  listProgramApplicationsMock,
} = vi.hoisted(() => ({
  decideApplicationMock: vi.fn(),
  getProgramDetailMock: vi.fn(),
  listProgramApplicationsMock: vi.fn(),
}));

vi.mock('./api', () => ({
  decideApplication: decideApplicationMock,
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

describe('staleApplicationDecisionTitle', () => {
  const problem = (status: number, code: string): ProblemDetail => ({
    type: 'about:blank',
    title: 'error',
    status,
    detail: 'detail',
    instance: 'urn:test:applications:app-1',
    code,
  });

  it('학생이 먼저 취소해 404가 오면 취소된 신청임을 알리고 목록을 다시 불러오게 한다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(404, 'APP_001'))),
    ).toBe('신청이 이미 취소되었습니다');
  });

  it('다른 운영자가 먼저 판정해 409가 오면 상태 변경으로 알린다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_002'))),
    ).toBe('신청 상태가 변경되었습니다');
  });

  it('404와 409는 서로 다른 문구를 쓴다 — 교직원이 원인을 구분할 수 있어야 한다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(404, 'APP_001'))),
    ).not.toBe(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_002'))),
    );
  });

  it('프로비저닝이 끝난 승인 되돌리기 409는 사람 말 안내를 쓴다', () => {
    expect(
      staleApplicationDecisionTitle(
        new ApiError({
          ...problem(409, 'APP_023'),
          revertBlockedReason:
            'repository provision already succeeded; undo is locked to protect the provisioned repository',
        } as ProblemDetail & { readonly revertBlockedReason: string }),
      ),
    ).toBe('저장소가 이미 만들어진 승인은 되돌릴 수 없습니다');
  });

  it('일반 409와 되돌리기 잠금 409는 서로 다른 문구를 쓴다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_002'))),
    ).not.toBe(
      staleApplicationDecisionTitle(new ApiError(problem(409, 'APP_023'))),
    );
  });

  it('권한·검증 실패는 목록 재조회 경로로 보내지 않는다', () => {
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(403, 'APP_004'))),
    ).toBeNull();
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(400, 'APP_003'))),
    ).toBeNull();
    expect(
      staleApplicationDecisionTitle(new ApiError(problem(500, 'SYS_001'))),
    ).toBeNull();
  });

  it('네트워크 오류처럼 ApiError가 아닌 실패는 판단하지 않는다', () => {
    expect(staleApplicationDecisionTitle(new Error('network'))).toBeNull();
    expect(staleApplicationDecisionTitle(null)).toBeNull();
    expect(staleApplicationDecisionTitle({ status: 404 })).toBeNull();
  });
});

describe('program applicants revert action', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    decideApplicationMock.mockReset();
    getProgramDetailMock.mockReset();
    listProgramApplicationsMock.mockReset();
    getProgramDetailMock.mockResolvedValue(program);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('판정되지 않은 행에는 되돌리기가 보이지 않는다', async () => {
    listProgramApplicationsMock.mockResolvedValue(applicationPage([personal]));

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(queryButton('되돌리기')).toBeUndefined();
    expect(getButton('승인')).toBeTruthy();
    expect(getButton('반려')).toBeTruthy();
  });

  it('반려된 행에서 되돌리기를 확정하면 REVERT를 보낸다', async () => {
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([rejected]))
      .mockResolvedValueOnce(
        applicationPage([
          { ...rejected, status: 'SUBMITTED', rejectionReason: null },
        ]),
      );
    decideApplicationMock.mockResolvedValue({
      applicationId: rejected.id,
      status: 'SUBMITTED',
    });

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      getButton('되돌리기').click();
    });
    await act(async () => {
      getButton('되돌리기 확정').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(decideApplicationMock).toHaveBeenCalledWith(rejected.id, {
      action: 'REVERT',
    });
    expect(container.textContent).toContain('되돌린 결과를 다시 불러왔습니다.');
    expect(container.textContent).toContain('제출됨');
  });

  it('409 + revertBlockedReason 응답을 사람 말 안내로 보여 준다', async () => {
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([team]))
      .mockResolvedValueOnce(applicationPage([team]));
    decideApplicationMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '저장소 프로비저닝이 완료된 승인은 되돌릴 수 없습니다.',
        instance: 'urn:test:applications:app-team',
        code: 'APP_023',
        revertBlockedReason:
          'repository provision already succeeded; undo is locked to protect the provisioned repository',
      } as ProblemDetail & { readonly revertBlockedReason: string }),
    );

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      getButton('되돌리기').click();
    });
    await act(async () => {
      getButton('되돌리기 확정').click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      '저장소가 이미 만들어진 승인은 되돌릴 수 없습니다',
    );
    expect(container.textContent).not.toContain(
      'repository provision already succeeded',
    );
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
