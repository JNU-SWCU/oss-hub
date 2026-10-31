import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../test-support/render-with-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryClient = createTestQueryClient();
beforeEach(() => {
  queryClient.clear();
  notifyManager.setScheduler(queueMicrotask);
});
afterEach(() => {
  queryClient.clear();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
});
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import { invalidateProgram } from '@/features/programs/catalog/queries';
import { invalidateBoard } from '@/features/board/queries';
import type { ProgramOverview } from '@/features/programs/catalog/program-overview-dto';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  getProgramOverview: vi.fn(),
  getProgramNavigationMilestones: vi.fn(),
  getMyApplication: vi.fn(),
  getProgramStatusCounts: vi.fn(),
}));

vi.mock('@/features/programs/catalog/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/catalog/program-navigation-api', () => ({
  getProgramNavigationMilestones: mocks.getProgramNavigationMilestones,
}));
vi.mock('@/features/programs/applications/student-application-api', () => ({
  getMyApplication: mocks.getMyApplication,
}));
vi.mock('@/features/programs/catalog/api', () => ({
  getProgramStatusCounts: mocks.getProgramStatusCounts,
}));

import { useProductShellData } from './use-product-shell-data';

const OVERVIEW: ProgramOverview = {
  programId: 'program-1',
  name: '합성 프로그램',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
  milestoneCount: 2,
  boardPostCount: 0,
  participantCount: 3,
  teamCount: 2,
  connectedRepositoryCount: 0,
  viewerRole: 'STAFF',
  viewerDocumentsCompleted: null,
  viewerDocumentsTotal: null,
  fullySubmittedParticipantCount: 0,
  remainingMilestones: [],
  milestoneDocuments: [],
};

function apiError(status: number, code: string): ApiError {
  const problem: ProblemDetail = {
    type: 'about:blank',
    title: 'error',
    status,
    detail: '',
    instance: '/synthetic/programs/program-1/applications/me',
    code,
  };
  return new ApiError(problem);
}

function Probe({
  programDetailId,
  member,
  studentViewer = false,
}: {
  readonly programDetailId: string | null;
  readonly member: boolean;
  readonly studentViewer?: boolean;
}) {
  const data = useProductShellData({
    section: 'programs',
    programDetailId,
    member,
    authority: {
      memberKind: studentViewer ? 'STUDENT' : 'STAFF',
      hasStaffAccess: !studentViewer,
      hasAdminAccess: false,
    },
  });
  return <output>{JSON.stringify(data)}</output>;
}

describe('useProductShellData 프로그램 단계 탐색', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('회원 프로그램 화면에서 overview와 공개 단계 목록을 함께 읽는다', async () => {
    mocks.getProgramOverview.mockResolvedValue(OVERVIEW);
    mocks.getProgramNavigationMilestones.mockResolvedValue([
      {
        milestoneId: 'plan',
        title: '1차 계획서',
        submissionEnabled: true,
      },
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member />
        </QueryClientProvider>,
      );
    });

    expect(mocks.getProgramOverview).toHaveBeenCalledWith('program-1', true);
    expect(mocks.getProgramNavigationMilestones).toHaveBeenCalledWith(
      'program-1',
    );
    expect(container.textContent).toContain('합성 프로그램');
    expect(container.textContent).toContain('1차 계획서');
  });

  it('제출 뒤 현재 프로그램 집계를 다시 읽고 교체 제출도 서버 집계를 유지한다', async () => {
    const overview = {
      ...OVERVIEW,
      viewerDocumentsCompleted: 0,
      viewerDocumentsTotal: 1,
      milestoneDocuments: [
        { milestoneId: 'plan', title: '계획서', completed: 0, total: 1 },
      ],
    };
    mocks.getProgramOverview.mockResolvedValue(overview);
    mocks.getProgramNavigationMilestones.mockResolvedValue([]);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member />
        </QueryClientProvider>,
      ),
    );
    expect(container.textContent).toContain('"viewerDocumentsCompleted":0');
    mocks.getProgramOverview.mockResolvedValue({
      ...overview,
      viewerDocumentsCompleted: 1,
    });
    await act(async () => invalidateProgram(queryClient, 'other-program'));
    expect(container.textContent).toContain('"viewerDocumentsCompleted":0');
    expect(mocks.getProgramOverview).toHaveBeenCalledTimes(1);
    await act(async () => invalidateProgram(queryClient, 'program-1'));
    expect(container.textContent).toContain('"viewerDocumentsCompleted":1');
    await act(async () => invalidateProgram(queryClient, 'program-1'));
    expect(container.textContent).toContain('"viewerDocumentsCompleted":1');
    expect(mocks.getProgramOverview).toHaveBeenCalledTimes(3);
    expect(mocks.getProgramNavigationMilestones).toHaveBeenCalledTimes(3);
  });

  it('첫 집계 응답보다 제출이 먼저 끝나도 해당 프로그램임을 확인한 뒤 다시 읽는다', async () => {
    const overview = {
      ...OVERVIEW,
      viewerDocumentsCompleted: 0,
      viewerDocumentsTotal: 1,
      milestoneDocuments: [
        { milestoneId: 'plan', title: '계획서', completed: 0, total: 1 },
      ],
    };
    let resolveInitial: (value: ProgramOverview) => void = () => {
      throw new TypeError('initial request missing');
    };
    mocks.getProgramOverview
      .mockReturnValueOnce(
        new Promise<ProgramOverview>((resolve) => {
          resolveInitial = resolve;
        }),
      )
      .mockResolvedValue({ ...overview, viewerDocumentsCompleted: 1 });
    mocks.getProgramNavigationMilestones.mockResolvedValue([]);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member />
        </QueryClientProvider>,
      ),
    );
    await act(async () => invalidateProgram(queryClient, 'program-1'));
    await act(async () => resolveInitial(overview));
    expect(container.textContent).toContain('"viewerDocumentsCompleted":1');
    expect(mocks.getProgramOverview).toHaveBeenCalledTimes(2);
  });

  it('이전 제출의 느린 집계 응답이 최신 제출 집계를 덮어쓰지 않는다', async () => {
    const overview = {
      ...OVERVIEW,
      viewerDocumentsCompleted: 0,
      viewerDocumentsTotal: 1,
      milestoneDocuments: [
        { milestoneId: 'plan', title: '계획서', completed: 0, total: 1 },
      ],
    };
    mocks.getProgramOverview.mockResolvedValueOnce(overview);
    mocks.getProgramNavigationMilestones.mockResolvedValue([]);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member />
        </QueryClientProvider>,
      ),
    );
    let resolveOlder: (value: ProgramOverview) => void = () => {
      throw new TypeError('older request missing');
    };
    mocks.getProgramOverview
      .mockReturnValueOnce(
        new Promise<ProgramOverview>((resolve) => {
          resolveOlder = resolve;
        }),
      )
      .mockResolvedValue({ ...overview, viewerDocumentsCompleted: 1 });
    await act(async () => {
      void invalidateProgram(queryClient, 'program-1');
    });
    await act(async () => invalidateProgram(queryClient, 'program-1'));
    expect(container.textContent).toContain('"viewerDocumentsCompleted":1');
    await act(async () => resolveOlder(overview));
    expect(container.textContent).toContain('"viewerDocumentsCompleted":1');
  });

  it('같은 프로그램 게시글 변경만 집계를 갱신하고 떠난 프로그램 집계는 다시 읽지 않는다', async () => {
    mocks.getProgramOverview.mockResolvedValue(OVERVIEW);
    mocks.getProgramNavigationMilestones.mockResolvedValue([]);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member />
        </QueryClientProvider>,
      ),
    );
    await act(async () => invalidateBoard(queryClient, 'other-program'));
    expect(mocks.getProgramOverview).toHaveBeenCalledTimes(1);
    mocks.getProgramOverview.mockResolvedValue({
      ...OVERVIEW,
      boardPostCount: 1,
    });
    await act(async () => invalidateBoard(queryClient, 'program-1'));
    expect(container.textContent).toContain('"boardPostCount":1');
    expect(mocks.getProgramOverview).toHaveBeenCalledTimes(2);
    expect(mocks.getProgramNavigationMilestones).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId={null} member />
        </QueryClientProvider>,
      ),
    );
    await act(async () => invalidateBoard(queryClient, 'program-1'));
    expect(mocks.getProgramOverview).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('"scopeOverview":');
  });

  it.each(['resolve', 'reject'] as const)(
    '첫 집계가 지연돼도 게시글 변경을 다시 읽고 이전 %s 결과를 무시한다',
    async (settle) => {
      let resolveInitial: (value: ProgramOverview) => void = () => {
        throw new Error('missing initial');
      };
      let rejectInitial: (error: Error) => void = () => {
        throw new Error('missing initial');
      };
      mocks.getProgramOverview
        .mockReturnValueOnce(
          new Promise<ProgramOverview>((resolve, reject) => {
            resolveInitial = resolve;
            rejectInitial = reject;
          }),
        )
        .mockResolvedValue({ ...OVERVIEW, boardPostCount: 1 });
      mocks.getProgramNavigationMilestones.mockResolvedValue([]);
      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe programDetailId="program-1" member />
          </QueryClientProvider>,
        ),
      );
      await act(async () => invalidateBoard(queryClient, 'program-1'));
      expect(container.textContent).toContain('"boardPostCount":1');
      await act(async () => {
        if (settle === 'resolve') resolveInitial(OVERVIEW);
        else rejectInitial(new Error('stale request'));
      });
      expect(container.textContent).toContain('"boardPostCount":1');
      expect(mocks.getProgramOverview).toHaveBeenCalledTimes(2);
    },
  );

  it('작성 뒤 느린 집계가 삭제 뒤 최신 수를 덮어쓰지 않는다', async () => {
    mocks.getProgramOverview.mockResolvedValue(OVERVIEW);
    mocks.getProgramNavigationMilestones.mockResolvedValue([]);
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member />
        </QueryClientProvider>,
      ),
    );
    let resolveOlder: (value: ProgramOverview) => void = () => {
      throw new Error('missing older');
    };
    mocks.getProgramOverview
      .mockReturnValueOnce(
        new Promise<ProgramOverview>((resolve) => {
          resolveOlder = resolve;
        }),
      )
      .mockResolvedValue(OVERVIEW);
    await act(async () => {
      void invalidateBoard(queryClient, 'program-1');
    });
    await act(async () => invalidateBoard(queryClient, 'program-1'));
    expect(mocks.getProgramOverview).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain('"boardPostCount":0');
    await act(async () => resolveOlder({ ...OVERVIEW, boardPostCount: 1 }));
    expect(container.textContent).toContain('"boardPostCount":0');
  });

  it('단계 조회가 실패해도 개요는 남기고 단계만 조용히 접는다', async () => {
    mocks.getProgramOverview.mockResolvedValue(OVERVIEW);
    mocks.getProgramNavigationMilestones.mockRejectedValue(
      new TypeError('network'),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain('합성 프로그램');
    expect(container.textContent).not.toContain('"scopeMilestones":');
    expect(container.textContent).not.toContain('scopeMilestonesFailed');
    expect(container.textContent).not.toContain('retryScopeMilestones');
    expect(mocks.getProgramNavigationMilestones).toHaveBeenCalledTimes(1);
  });

  it('비회원에게는 회원 전용 overview와 추가 단계 조회를 시작하지 않는다', async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member={false} />
        </QueryClientProvider>,
      );
    });

    expect(mocks.getProgramOverview).not.toHaveBeenCalled();
    expect(mocks.getProgramNavigationMilestones).not.toHaveBeenCalled();
    expect(mocks.getMyApplication).not.toHaveBeenCalled();
  });
});

describe('useProductShellData 참여 여부(#1099)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.getProgramOverview.mockResolvedValue(OVERVIEW);
    mocks.getProgramNavigationMilestones.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('승인된 신청이 있으면 참여자다', async () => {
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member studentViewer />
        </QueryClientProvider>,
      );
    });

    expect(mocks.getMyApplication).toHaveBeenCalledWith('program-1');
    expect(container.textContent).toContain('"scopeParticipant":true');
  });

  it('아직 승인되지 않은 신청은 참여자가 아니다', async () => {
    mocks.getMyApplication.mockResolvedValue({ status: 'SUBMITTED' });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member studentViewer />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain('"scopeParticipant":false');
  });

  it('신청이 없으면(null) 참여자가 아님이 확정된다', async () => {
    mocks.getMyApplication.mockResolvedValue(null);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member studentViewer />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain('"scopeParticipant":false');
  });

  it('실패는 모르는 채로 둔다 — 추측으로 메뉴를 잠그지 않는다', async () => {
    mocks.getMyApplication.mockRejectedValue(new TypeError('network'));

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member studentViewer />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).not.toContain('"scopeParticipant":');
  });

  it('프로그램이 없다는 404도 모르는 채로 둔다', async () => {
    mocks.getMyApplication.mockRejectedValue(apiError(404, 'APP_009'));

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member studentViewer />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).not.toContain('"scopeParticipant":');
  });

  it('학생 시야가 아니면 묻지 않는다 — 교직원은 참여 여부와 무관하게 열린다', async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member studentViewer={false} />
        </QueryClientProvider>,
      );
    });

    expect(mocks.getMyApplication).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('"scopeParticipant":');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useProductShellData 로딩 상태', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getProgramNavigationMilestones.mockResolvedValue([]);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function data(): Record<string, unknown> {
    return JSON.parse(container.textContent ?? '{}') as Record<string, unknown>;
  }

  it('overview 요청 중에는 첫 렌더부터 pending이고 응답이 오면 success다', async () => {
    const overview = deferred<ProgramOverview>();
    mocks.getProgramOverview.mockReturnValue(overview.promise);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member />
        </QueryClientProvider>,
      );
    });
    expect(data().scopeOverviewStatus).toBe('pending');
    expect(data().scopeOverview).toBeUndefined();

    await act(async () => {
      overview.resolve(OVERVIEW);
      await overview.promise;
    });
    expect(data().scopeOverviewStatus).toBe('success');
    expect(data().scopeOverview).toMatchObject({ name: '합성 프로그램' });
  });

  it('overview 요청이 실패하면 error가 되고 데이터는 비어 있다', async () => {
    const overview = deferred<ProgramOverview>();
    mocks.getProgramOverview.mockReturnValue(overview.promise);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      overview.reject(apiError(500, 'INTERNAL'));
      await overview.promise.catch(() => undefined);
    });

    expect(data().scopeOverviewStatus).toBe('error');
    expect(data().scopeOverview).toBeUndefined();
  });

  it('비회원은 overview를 부르지 않고 idle이다', async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId="program-1" member={false} />
        </QueryClientProvider>,
      );
    });

    expect(mocks.getProgramOverview).not.toHaveBeenCalled();
    expect(data().scopeOverviewStatus).toBe('idle');
    expect(data().facetStatus).toBe('idle');
  });

  it('섹션 집계도 pending에서 success 또는 error로 끝난다', async () => {
    const counts = deferred<Record<string, number>>();
    mocks.getProgramStatusCounts.mockReturnValue(counts.promise);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId={null} member />
        </QueryClientProvider>,
      );
    });
    expect(data().facetStatus).toBe('pending');
    expect(data().scopeOverviewStatus).toBe('idle');

    await act(async () => {
      counts.resolve({ in_progress: 3 });
      await counts.promise;
    });
    expect(data().facetStatus).toBe('success');

    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.getProgramStatusCounts.mockRejectedValue(new TypeError('network'));
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe programDetailId={null} member />
        </QueryClientProvider>,
      );
    });
    expect(data().facetStatus).toBe('error');
  });
});
