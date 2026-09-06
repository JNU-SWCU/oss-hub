// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import type { ProgramOverview } from '@/features/programs/program-overview-api';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  getProgramOverview: vi.fn(),
  getProgramNavigationMilestones: vi.fn(),
  getMyApplication: vi.fn(),
}));

vi.mock('@/features/programs/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/program-navigation-api', () => ({
  getProgramNavigationMilestones: mocks.getProgramNavigationMilestones,
}));
vi.mock('@/features/programs/student-application-api', () => ({
  getMyApplication: mocks.getMyApplication,
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
    studentViewer,
  });
  return (
    <>
      <output>{JSON.stringify(data)}</output>
      <button type="button" onClick={data.retryScopeMilestones}>
        단계 다시 불러오기
      </button>
    </>
  );
}

describe('useProductShellData 프로그램 단계 탐색', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
      root.render(<Probe programDetailId="program-1" member />);
    });

    expect(mocks.getProgramOverview).toHaveBeenCalledWith('program-1');
    expect(mocks.getProgramNavigationMilestones).toHaveBeenCalledWith(
      'program-1',
    );
    expect(container.textContent).toContain('합성 프로그램');
    expect(container.textContent).toContain('1차 계획서');
  });

  it('공개 단계 조회 실패를 알리고 사용자가 그 조회만 다시 시도할 수 있다', async () => {
    mocks.getProgramOverview.mockResolvedValue(OVERVIEW);
    mocks.getProgramNavigationMilestones
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce([
        {
          milestoneId: 'mid',
          title: '중간 보고서',
          submissionEnabled: true,
        },
      ]);

    await act(async () => {
      root.render(<Probe programDetailId="program-1" member />);
    });

    expect(container.textContent).toContain('합성 프로그램');
    expect(container.textContent).not.toContain('"scopeMilestones":');
    expect(container.textContent).toContain('"scopeMilestonesFailed":true');

    await act(async () => {
      container.querySelector('button')?.click();
    });

    expect(mocks.getProgramNavigationMilestones).toHaveBeenCalledTimes(2);
    expect(mocks.getProgramOverview).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('중간 보고서');
    expect(container.textContent).toContain('"scopeMilestonesFailed":false');
  });

  it('비회원에게는 회원 전용 overview와 추가 단계 조회를 시작하지 않는다', async () => {
    await act(async () => {
      root.render(<Probe programDetailId="program-1" member={false} />);
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
      root.render(<Probe programDetailId="program-1" member studentViewer />);
    });

    expect(mocks.getMyApplication).toHaveBeenCalledWith('program-1');
    expect(container.textContent).toContain('"scopeParticipant":true');
  });

  it('아직 승인되지 않은 신청은 참여자가 아니다', async () => {
    mocks.getMyApplication.mockResolvedValue({ status: 'SUBMITTED' });

    await act(async () => {
      root.render(<Probe programDetailId="program-1" member studentViewer />);
    });

    expect(container.textContent).toContain('"scopeParticipant":false');
  });

  it('신청이 없으면(404) 참여자가 아님이 확정된다', async () => {
    mocks.getMyApplication.mockRejectedValue(apiError(404, 'APP_001'));

    await act(async () => {
      root.render(<Probe programDetailId="program-1" member studentViewer />);
    });

    expect(container.textContent).toContain('"scopeParticipant":false');
  });

  it('404가 아닌 실패는 모르는 채로 둔다 — 추측으로 메뉴를 잠그지 않는다', async () => {
    mocks.getMyApplication.mockRejectedValue(new TypeError('network'));

    await act(async () => {
      root.render(<Probe programDetailId="program-1" member studentViewer />);
    });

    // undefined는 JSON.stringify가 키째로 지운다 — 「모른다」가 그대로 남았다는 뜻이다.
    expect(container.textContent).not.toContain('"scopeParticipant":');
  });

  it('학생 시야가 아니면 묻지 않는다 — 교직원은 참여 여부와 무관하게 열린다', async () => {
    await act(async () => {
      root.render(
        <Probe programDetailId="program-1" member studentViewer={false} />,
      );
    });

    expect(mocks.getMyApplication).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('"scopeParticipant":');
  });
});
