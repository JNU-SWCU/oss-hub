// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramOverview } from '@/features/programs/program-overview-api';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  getProgramOverview: vi.fn(),
  getProgramNavigationMilestones: vi.fn(),
}));

vi.mock('@/features/programs/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/program-navigation-api', () => ({
  getProgramNavigationMilestones: mocks.getProgramNavigationMilestones,
}));

import { useProductShellData } from './use-product-shell-data';

const OVERVIEW: ProgramOverview = {
  programId: 'program-1',
  name: '합성 프로그램',
  category: 'OSS_CONTEST',
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

function Probe({
  programDetailId,
  member,
}: {
  readonly programDetailId: string | null;
  readonly member: boolean;
}) {
  const data = useProductShellData({
    section: 'programs',
    programDetailId,
    member,
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
  });
});
