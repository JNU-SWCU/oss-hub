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
import {
  applicationDecisionTriggerId,
  staleApplicationDecisionTitle,
} from './application-presentation';
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

/**
 * Radix 는 확인창이 닫힐 때의 포커스 복귀를 `setTimeout` 안에서 뒤늦게 한다.
 * 그걸 흘려보내지 않으면 화면이 옮겨 둔 포커스가 살아남는지 확인할 수 없다([#767]).
 */
async function flushCloseAutoFocus(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
    // ⚠ 포커스가 문서 맨 앞인 상태에서 시작한다 — 앞 테스트가 문서에 **붙인 채로** 남긴
    //   요소가 포커스를 쥐고 있으면, 「비어 있을 때만 옮긴다」 가드가 그 요소 때문에 갈려
    //   복귀 규칙을 검사한 것이 아니게 된다. (떨어져 나간 노드는 happy-dom 이 스스로
    //   `body` 로 되돌리므로 그쪽은 걱정할 것이 없다 — 실측으로 확인했다.)
    (document.activeElement as HTMLElement | null)?.blur();
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

  it('낡은 상태 재조회를 기다리는 사이 다른 행을 판정해도 그 행의 처리 중이 안 풀린다', async () => {
    // Given: A 행이 409 로 실패해 창을 먼저 닫고 **느린 재조회**를 기다린다.
    // ⚠ 늦게 끝난 A 요청이 B 행의 「처리 중」을 지우면 확정 버튼이 다시 열려 중복 호출된다.
    const second: ApplicationListItem = {
      ...personal,
      id: 'app-personal-2',
      applicant: {
        ...personal.applicant,
        id: 'student-2',
        nickname: 'login-2',
      },
    };
    const slowReload = deferred<ApplicationListPage>();
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([personal, second]))
      .mockReturnValueOnce(slowReload.promise);
    const pendingB = deferred<{ applicationId: string; status: string }>();
    decideApplicationMock
      .mockRejectedValueOnce(
        new ApiError({
          type: 'about:blank',
          title: 'conflict',
          status: 409,
          detail: 'stale',
          instance: 'urn:test:applications:app-personal',
          code: 'APP_021',
        }),
      )
      .mockReturnValueOnce(pendingB.promise);

    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const approveButtons = () =>
      Array.from(document.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === '승인',
      );

    // A 행 판정 → 409 → 창 닫힘, 재조회는 아직 안 끝났다.
    await act(async () => approveButtons()[0]!.click());
    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    // When: 그 사이 B 행을 판정하고, 그 뒤에 A 의 재조회가 끝난다.
    await act(async () => approveButtons()[1]!.click());
    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      slowReload.resolve(applicationPage([personal, second]));
      await Promise.resolve();
    });

    // Then: B 는 아직 처리 중이므로 확정 버튼이 다시 열리지 않는다.
    expect(getButton('처리 중…').disabled).toBe(true);
  });

  it('실패한 뒤 다시 확정하면 이전 실패 안내가 먼저 사라진다', async () => {
    // Given: 한 번 실패해 확인창 안에 안내가 떠 있다.
    // ⚠ 안 지우면 「처리 중…」과 이전 실패가 같이 보이고, 같은 문구로 또 실패하면
    //   DOM 이 그대로라 읽어 주는 도구가 다시 발표하지 않는다.
    listProgramApplicationsMock.mockResolvedValue(applicationPage([personal]));
    const pending = deferred<{ applicationId: string; status: string }>();
    decideApplicationMock
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockReturnValueOnce(pending.promise);
    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => getButton('승인').click());
    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain('판정을 저장하지 못했습니다');

    // When: 다시 확정한다(두 번째 요청은 아직 안 끝났다).
    await act(async () => getButton('승인 확정').click());

    // Then: 이전 실패 안내가 사라진 채로 처리 중이다.
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).not.toContain('판정을 저장하지 못했습니다');
    expect(getButton('처리 중…').disabled).toBe(true);
  });

  it('판정 저장이 실패하면 확인창 안에서 말한다 — 창 뒤에 그리면 못 본다', async () => {
    // Given: 확인창을 열고 저장이 일반 오류로 실패한다.
    listProgramApplicationsMock.mockResolvedValue(applicationPage([personal]));
    decideApplicationMock.mockRejectedValue(new Error('synthetic failure'));
    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => getButton('승인').click());

    // When: 승인을 확정한다.
    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      await Promise.resolve();
    });

    // Then: 창은 열린 채이고, 실패 안내가 그 **창 안에** 있다.
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('판정을 저장하지 못했습니다');
    expect(dialog?.textContent).toContain('입력과 현재 상태를 유지했습니다');
  });

  it('낡은 상태 재조회까지 실패해도 안내가 확인창 뒤에 가리지 않는다', async () => {
    // Given: 409(낡은 상태)로 실패하고, 최신 상태를 다시 읽는 것마저 실패한다.
    // ⚠ 이때 확인창을 안 닫고 화면 위쪽에 안내를 그리면 창 뒤에 가려 아무도 못 본다.
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([personal]))
      .mockRejectedValueOnce(new Error('synthetic reload failure'));
    decideApplicationMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'conflict',
        status: 409,
        detail: 'stale',
        instance: 'urn:test:applications:app-personal',
        code: 'APP_021',
      }),
    );
    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => getButton('승인').click());

    // When: 승인을 확정한다.
    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      await Promise.resolve();
    });

    // Then: 확인창이 닫혀 있어 안내가 가리지 않는다.
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.textContent).toContain('최신 상태 확인 실패');
  });

  it('확인창을 Escape 로 닫으면 그 행의 판정 버튼으로 포커스가 돌아온다', async () => {
    // Given: 제출됨 행이 **둘** 있다. 창을 연 그 행으로 돌아가야 한다.
    // ⚠ 행이 하나뿐이면 모든 행이 같은 id 를 써도 통과한다 — 그래서 둘째 행으로 연다.
    const second: ApplicationListItem = {
      ...personal,
      id: 'app-personal-2',
      applicant: {
        ...personal.applicant,
        id: 'student-2',
        nickname: 'login-2',
      },
    };
    listProgramApplicationsMock.mockResolvedValue(
      applicationPage([personal, second]),
    );
    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const approveButtons = Array.from(
      document.querySelectorAll('button'),
    ).filter((button) => button.textContent?.trim() === '승인');
    expect(approveButtons).toHaveLength(2);
    const trigger = approveButtons[1]!;
    await act(async () => trigger.click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    const focusReturned = new Promise<void>((resolve) => {
      trigger.addEventListener('focus', () => resolve(), { once: true });
    });

    // When: 키보드로 Escape 를 누른다.
    await act(async () => {
      getButton('취소').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await focusReturned;

    // Then
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
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

  it('판정에 성공해 확인창이 스스로 닫히면 그 행의 새 버튼으로 포커스가 간다', async () => {
    // Given: 제출됨 행이 **둘** 있다.
    // ⚠ 행이 하나뿐이면 아무 행의 버튼이나 잡아도 통과한다 — 그래서 둘째 행으로 연다.
    // ⚠ 성공하면 「승인」이 **사라지고** 「되돌리기」가 생긴다. 새 버튼은 **재조회가
    //   끝난 뒤에야** DOM 에 생기므로 창이 닫히는 순간에는 찾을 수 없다([#767]).
    const second: ApplicationListItem = { ...personal, id: 'app-personal-2' };
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([personal, second]))
      .mockResolvedValueOnce(
        applicationPage([personal, { ...second, status: 'APPROVED' }]),
      );
    decideApplicationMock.mockResolvedValue({
      applicationId: second.id,
      status: 'APPROVED',
    });
    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const approveButtons = Array.from(
      document.querySelectorAll('button'),
    ).filter((button) => button.textContent?.trim() === '승인');
    expect(approveButtons).toHaveLength(2);

    // When: 둘째 행을 승인한다.
    await act(async () => approveButtons[1]!.click());
    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    await flushCloseAutoFocus();

    // Then: 문서 맨 앞이 아니라 **그 행**의 새 버튼에 있다.
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.id).toBe(
      applicationDecisionTriggerId('REVERT', second.id),
    );
  });

  it('재조회를 기다리는 사이 사용자가 다른 곳을 잡았으면 포커스를 뺏지 않는다', async () => {
    // ⚠ 확인창은 재조회를 **기다리기 전에** 닫힌다 — 그 사이 화면은 이미 조작할 수 있다.
    // 재조회가 느리면 사용자는 그동안 다른 칸으로 옮겨 간다. 늦게 도착한 예약이 그걸
    // 뺏으면 이 PR 이 고치려는 것과 **같은 고장을 반대 방향으로** 만든다.
    const second: ApplicationListItem = { ...personal, id: 'app-personal-2' };
    const reload = deferred<ApplicationListPage>();
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([personal, second]))
      .mockReturnValueOnce(reload.promise);
    decideApplicationMock.mockResolvedValue({
      applicationId: second.id,
      status: 'APPROVED',
    });
    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const approveButtons = Array.from(
      document.querySelectorAll('button'),
    ).filter((button) => button.textContent?.trim() === '승인');

    // When: 둘째 행을 승인하고, 재조회가 아직 안 끝난 사이에 다른 칸을 잡는다.
    await act(async () => approveButtons[1]!.click());
    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);

    await act(async () => {
      reload.resolve(
        applicationPage([personal, { ...second, status: 'APPROVED' }]),
      );
      await Promise.resolve();
    });
    await flushCloseAutoFocus();

    // Then: 사용자가 잡은 자리가 그대로다.
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('되돌리기에 성공하면 그 행에 다시 생긴 승인 버튼으로 포커스가 간다', async () => {
    // 판정마다 무엇이 남는지가 다르다 — 승인 한 갈래만 고치면 되돌리기는 그대로 튕긴다.
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([personal, rejected]))
      .mockResolvedValueOnce(
        applicationPage([
          personal,
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

    await act(async () => getButton('되돌리기').click());
    await act(async () => getButton('되돌리기 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    await flushCloseAutoFocus();

    expect((document.activeElement as HTMLElement | null)?.id).toBe(
      applicationDecisionTriggerId('APPROVE', rejected.id),
    );
  });

  it('낡은 상태(409)로 창이 닫혀도 포커스가 문서 맨 앞으로 떨어지지 않는다', async () => {
    // 다른 운영자가 먼저 판정한 경우다. 창을 닫는 시점에는 그 버튼이 아직 `disabled`
    // 라 포커스를 못 받고, 재조회가 끝나면 아예 다른 버튼이 되어 있다.
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([personal]))
      .mockResolvedValueOnce(
        applicationPage([{ ...personal, status: 'APPROVED' }]),
      );
    decideApplicationMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'conflict',
        status: 409,
        detail: 'stale',
        instance: 'urn:test:applications:app-personal',
        code: 'APP_002',
      }),
    );
    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => getButton('승인').click());
    await act(async () => getButton('승인 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    await flushCloseAutoFocus();

    expect(document.activeElement).not.toBe(document.body);
    expect((document.activeElement as HTMLElement | null)?.id).toBe(
      applicationDecisionTriggerId('REVERT', personal.id),
    );
  });

  it('재조회까지 실패해 행이 그대로면 누르던 그 버튼으로 돌아온다', async () => {
    // Given: 409 로 실패하고 최신 상태를 다시 읽는 것마저 실패한다 — 행은 그대로다.
    // ⚠ 이때 「승인」으로 보내면 교직원은 자기가 **반려**를 누르던 중이었다는 것을 잃는다.
    listProgramApplicationsMock
      .mockResolvedValueOnce(applicationPage([personal]))
      .mockRejectedValueOnce(new Error('synthetic reload failure'));
    decideApplicationMock.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'conflict',
        status: 409,
        detail: 'stale',
        instance: 'urn:test:applications:app-personal',
        code: 'APP_002',
      }),
    );
    await act(async () => {
      root.render(<ProgramApplicantsPage programId="program-1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // When: 반려를 확정한다.
    await act(async () => getButton('반려').click());
    const textarea = document.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError('반려 사유 입력칸이 없다');
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(textarea, '합성 반려 사유');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => getButton('반려 확정').click());
    await act(async () => {
      await Promise.resolve();
    });
    await flushCloseAutoFocus();

    // Then: 승인이 아니라 반려로 돌아온다.
    expect((document.activeElement as HTMLElement | null)?.id).toBe(
      applicationDecisionTriggerId('REJECT', personal.id),
    );
  });
});
