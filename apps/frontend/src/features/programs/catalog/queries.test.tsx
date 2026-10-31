import { act } from 'react';
import { notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../test-support/render-with-query';
import { programFeatureKey } from '@/lib/query-keys';
import type { ProgramDetail } from './dto';
import type { ProgramOverview } from './program-overview-dto';
import { ProgramDetailPage } from './program-detail-page';
import { invalidateProgram, useProgramOverviewQuery } from './queries';

const api = vi.hoisted(() => ({
  getProgramDetail: vi.fn(),
  getPublicProgramDetail: vi.fn(),
  getProgramOverview: vi.fn(),
  getProgramActivity: vi.fn(),
  router: { replace: vi.fn() },
}));

vi.mock('./api', () => ({
  getProgramDetail: api.getProgramDetail,
  getPublicProgramDetail: api.getPublicProgramDetail,
  getProgramActivity: api.getProgramActivity,
}));
vi.mock('./program-overview-api', () => ({
  getProgramOverview: api.getProgramOverview,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => api.router,
}));
vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />,
}));

const detail: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '기관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-12-31T00:00:00.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
  milestones: [],
};

const overview: ProgramOverview = {
  programId: detail.id,
  name: detail.name,
  trackType: detail.trackType,
  lifecycle: detail.lifecycle,
  milestoneCount: 0,
  boardPostCount: 0,
  participantCount: 1,
  teamCount: 1,
  connectedRepositoryCount: 0,
  viewerRole: 'STUDENT',
  viewerDocumentsCompleted: 0,
  viewerDocumentsTotal: 1,
  fullySubmittedParticipantCount: null,
  remainingMilestones: [],
  milestoneDocuments: [],
};

function Overview({ programId }: { readonly programId: string }) {
  const query = useProgramOverviewQuery(programId, false);
  return <output>{query.data?.viewerDocumentsCompleted}</output>;
}

describe('공유 프로그램 쿼리', () => {
  let view: Awaited<ReturnType<typeof renderWithQuery>> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    notifyManager.setScheduler(queueMicrotask);
    api.getProgramDetail.mockResolvedValue(detail);
    api.getPublicProgramDetail.mockResolvedValue(detail);
    api.getProgramOverview.mockResolvedValue(overview);
    api.getProgramActivity.mockResolvedValue([]);
  });

  afterEach(async () => {
    await view?.unmount();
    view = undefined;
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  });

  it('첫 overview 실패에도 상세를 표시하고 갱신 실패 경고는 표시하지 않는다', async () => {
    api.getProgramOverview.mockRejectedValue(new TypeError('overview 500'));

    view = await renderWithQuery(
      <ProgramDetailPage
        programId={detail.id}
        session="present"
        renderSignInApply={() => null}
      />,
    );

    expect(view.container.querySelector('h1')?.textContent).toContain(
      detail.name,
    );
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('백그라운드 overview 실패는 이전 집계와 DOM을 유지하고 재시도로 회복한다', async () => {
    view = await renderWithQuery(
      <ProgramDetailPage
        programId={detail.id}
        session="present"
        renderSignInApply={() => null}
      />,
    );
    const heading = view.container.querySelector('h1');
    const client = view.queryClient;
    api.getProgramOverview.mockRejectedValue(new TypeError('overview 500'));

    await act(() => invalidateProgram(client, detail.id));

    expect(view.container.querySelector('h1')).toBe(heading);
    expect(view.container.textContent).toContain('0 / 1 서류');
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    api.getProgramOverview.mockResolvedValue({
      ...overview,
      viewerDocumentsCompleted: 1,
    });
    const retry = view.container.querySelector('[role="alert"] button');
    if (!(retry instanceof HTMLButtonElement))
      throw new TypeError('retry button missing');
    const recovered = new Promise<void>((resolve) => {
      const unsubscribe = client.getQueryCache().subscribe(() => {
        const state = client.getQueryState(
          programFeatureKey(detail.id, 'overview', false),
        );
        if (state?.status === 'success' && state.fetchStatus === 'idle') {
          unsubscribe();
          resolve();
        }
      });
    });
    await act(async () => {
      retry.click();
      await recovered;
    });
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.container.textContent).toContain('1 / 1 서류');
  });

  it('첫 응답 전에 무효화하면 새 응답을 공유하고 늦은 이전 응답은 버린다', async () => {
    let resolveOld: (value: ProgramOverview) => void = () => {
      throw new TypeError('initial request missing');
    };
    api.getProgramOverview
      .mockReturnValueOnce(
        new Promise<ProgramOverview>((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValue({ ...overview, viewerDocumentsCompleted: 1 });
    view = await renderWithQuery(
      <>
        <Overview programId={detail.id} />
        <Overview programId={detail.id} />
      </>,
    );
    expect(api.getProgramOverview).toHaveBeenCalledTimes(1);
    const client = view.queryClient;

    await act(() => invalidateProgram(client, detail.id));
    await act(async () => resolveOld(overview));

    expect(api.getProgramOverview).toHaveBeenCalledTimes(2);
    expect(
      [...view.container.querySelectorAll('output')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['1', '1']);
  });

  it('첫 overview가 없던 상세도 갱신 중 DOM을 유지하고 재실패를 알린다', async () => {
    api.getProgramOverview.mockRejectedValue(new TypeError('overview 500'));
    view = await renderWithQuery(
      <ProgramDetailPage
        programId={detail.id}
        session="present"
        renderSignInApply={() => null}
      />,
    );
    const heading = view.container.querySelector('h1');
    let rejectRefresh: (error: Error) => void = () => {
      throw new TypeError('refresh request missing');
    };
    api.getProgramOverview.mockReturnValue(
      new Promise<ProgramOverview>((_resolve, reject) => {
        rejectRefresh = reject;
      }),
    );
    const client = view.queryClient;
    let refresh = Promise.resolve();

    await act(async () => {
      refresh = invalidateProgram(client, detail.id);
    });

    expect(view.container.querySelector('h1')).toBe(heading);
    await act(async () => {
      rejectRefresh(new TypeError('overview still unavailable'));
      await refresh;
    });
    expect(view.container.querySelector('h1')).toBe(heading);
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('다른 프로그램을 무효화해도 현재 상세를 다시 읽지 않는다', async () => {
    view = await renderWithQuery(<Overview programId={detail.id} />);
    const client = view.queryClient;

    await act(() => invalidateProgram(client, 'other-program'));

    expect(api.getProgramOverview).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe('0');
  });

  it('익명 상세는 공개 API만 호출한다', async () => {
    view = await renderWithQuery(
      <ProgramDetailPage
        programId={detail.id}
        session="anonymous"
        renderSignInApply={() => null}
      />,
    );

    expect(api.getPublicProgramDetail).toHaveBeenCalledWith(detail.id);
    expect(api.getProgramDetail).not.toHaveBeenCalled();
    expect(api.getProgramOverview).not.toHaveBeenCalled();
    expect(view.container.querySelector('h1')?.textContent).toContain(
      detail.name,
    );
  });
});
