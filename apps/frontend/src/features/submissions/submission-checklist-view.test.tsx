import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ChecklistLoadFailure,
  ChecklistSkeleton,
  SubmissionChecklistView,
  type SubmissionChecklistViewProps,
} from './components/submission-checklist-view';
import type {
  ChecklistSubmission,
  SubmissionChecklist,
  SubmissionChecklistItem,
} from './types';

// 기준 시각: Seoul 2026-07-24 12:00.
const NOW = new Date('2026-07-24T03:00:00Z');

function submission(
  overrides: Partial<ChecklistSubmission>,
): ChecklistSubmission {
  return {
    id: 'submission-1',
    status: 'SUBMITTED',
    currentRevision: 1,
    lastReviewedAt: null,
    reviewComment: null,
    canResubmit: false,
    ...overrides,
  };
}

const ITEMS: readonly SubmissionChecklistItem[] = [
  {
    milestoneId: 'milestone-plan',
    name: '기획서 제출',
    dueAt: '2026-07-21T14:59:59.000Z', // Seoul 07-21 23:59:59 → 마감 지남
    submissionType: 'FILE',
    submission: submission({
      id: 'submission-plan',
      status: 'APPROVED',
      lastReviewedAt: '2026-07-22T01:00:00.000Z',
    }),
  },
  {
    milestoneId: 'milestone-interim',
    name: '중간 보고',
    dueAt: '2026-07-27T14:59:59.000Z', // Seoul 07-27 → D-3
    submissionType: 'TEXT',
    submission: submission({
      id: 'submission-interim',
      status: 'CHANGES_REQUESTED',
      reviewComment: '실행 화면 캡처를 추가해 주세요.',
      lastReviewedAt: '2026-07-23T01:00:00.000Z',
      canResubmit: true,
    }),
  },
  {
    milestoneId: 'milestone-demo',
    name: '시연 영상',
    dueAt: '2026-07-30T14:59:59.000Z',
    submissionType: 'REPOSITORY_RELEASE',
    submission: submission({ id: 'submission-demo', status: 'SUBMITTED' }),
  },
  {
    milestoneId: 'milestone-retro',
    name: '회고 제출',
    dueAt: '2026-08-03T14:59:59.000Z',
    submissionType: 'TEXT',
    submission: submission({
      id: 'submission-retro',
      status: 'REJECTED',
      reviewComment: '중복 제출로 최종 반려되었습니다.',
      lastReviewedAt: '2026-07-23T02:00:00.000Z',
    }),
  },
  {
    milestoneId: 'milestone-final',
    name: '최종 제출',
    dueAt: '2026-08-13T14:59:59.000Z', // Seoul 08-13 → D-20
    submissionType: 'TEXT',
    submission: null,
  },
];

const CHECKLIST: SubmissionChecklist = {
  applicationId: 'application-personal',
  applicationMode: 'PERSONAL',
  items: ITEMS,
};

const handlers = {
  onTextChange: vi.fn(),
  onReleaseUrlChange: vi.fn(),
  onCommentChange: vi.fn(),
  onResubmit: vi.fn(),
};

function render(overrides: Partial<SubmissionChecklistViewProps> = {}): string {
  return renderToStaticMarkup(
    <SubmissionChecklistView
      programId="program-1"
      checklist={CHECKLIST}
      selectedMilestoneId={null}
      now={NOW}
      input={{ text: '', releaseUrl: '' }}
      comment=""
      errors={{}}
      serverError={null}
      staleNotice={null}
      toastMessage={null}
      submitting={false}
      {...handlers}
      {...overrides}
    />,
  );
}

describe('SubmissionChecklistView 체크리스트', () => {
  it('상태 5종을 programs 화면과 같은 라벨·행동 버튼으로 렌더한다', () => {
    // When
    const html = render();

    // Then: 5종 상태 라벨.
    expect(html).toContain('제출 전');
    expect(html).toContain('제출됨');
    expect(html).toContain('승인');
    expect(html).toContain('보완 필요');
    expect(html).toContain('최종 반려');
    // 행동 버튼: 미제출 → #115 제출 화면, 보완 → 사유·재제출, 나머지 → 보기.
    expect(html).toContain(
      '/programs/program-1/milestones/milestone-final/submit',
    );
    expect(html).toContain('제출하기');
    expect(html).toContain('사유·재제출');
    expect(html).toContain('보기');
    expect(html).toContain(
      '/programs/program-1/submissions?milestoneId=milestone-interim',
    );
  });

  it('D-day는 Asia/Seoul 기준 표시 상태로 계산한다', () => {
    // When
    const html = render();

    // Then
    expect(html).toContain('마감 지남'); // 기획서 (지난 마감)
    expect(html).toContain('D-3'); // 중간 보고
    expect(html).toContain('D-20'); // 최종 제출
  });

  it('서버 정렬이 깨져도 dueAt epoch 기준으로 방어 정렬한다', () => {
    // Given: 역순 전달.
    const html = render({
      checklist: { ...CHECKLIST, items: [...ITEMS].reverse() },
    });

    // Then: 이름 등장 순서가 dueAt ASC.
    const order = [
      '기획서 제출',
      '중간 보고',
      '시연 영상',
      '회고 제출',
      '최종 제출',
    ].map((name) => html.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it('마일스톤이 없으면 빈 상태 안내를 보여준다', () => {
    const html = render({ checklist: { ...CHECKLIST, items: [] } });
    expect(html).toContain('표시할 마일스톤이 없습니다');
  });

  it('토스트·stale 안내·일반 오류 Alert를 렌더한다', () => {
    const html = render({
      toastMessage:
        'revision 2을 제출했습니다. 검토 대기 상태로 전환되었습니다.',
      staleNotice:
        '다른 곳에서 제출 상태가 바뀌어 최신 상태를 다시 불러왔습니다.',
      serverError: '재제출하지 못했습니다.',
    });
    expect(html).toContain('role="status"');
    expect(html).toContain('revision 2을 제출했습니다');
    expect(html).toContain('제출 상태가 변경되었습니다');
    expect(html).toContain('재제출 실패');
    expect(html).toContain('재제출하지 못했습니다.');
  });
});

describe('SubmissionChecklistView 선택 패널', () => {
  it('보완 필요 선택 시 코멘트·현재 revision·#115 입력·재제출 버튼을 보여준다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-interim' });

    // Then
    expect(html).toContain('교직원 코멘트');
    expect(html).toContain('실행 화면 캡처를 추가해 주세요.');
    expect(html).toContain('현재 revision');
    expect(html).toContain('id="submission-text"'); // #115 유형별 입력 재사용
    expect(html).toContain('id="resubmission-comment"');
    expect(html).toContain('revision 2 제출');
    expect(html).toContain('취소');
  });

  it('검토 대기 선택 시 revision을 보여주고 입력을 비활성화한다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-demo' });

    // Then
    expect(html).toContain('revision 1 검토 대기 중입니다');
    expect(html).toContain('disabled=""');
    expect(html).toContain('검토 대기 중');
    expect(html).not.toContain('revision 2 제출');
  });

  it('승인 선택 시 완료 배지와 검토 시각을 보여준다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-plan' });

    // Then
    expect(html).toContain('제출이 승인되었습니다');
    expect(html).toContain('data-variant="approved"');
    expect(html).toContain('검토 시각');
  });

  it('최종 반려 선택 시 코멘트 읽기 전용이고 재제출 폼이 없다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-retro' });

    // Then
    expect(html).toContain('중복 제출로 최종 반려되었습니다.');
    expect(html).toContain('최종 반려된 제출은 재제출할 수 없습니다.');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('id="submission-text"');
  });

  it('FILE 유형 보완 요청은 fail-closed로 재제출을 막는다', () => {
    // Given: FILE 마일스톤이 보완 요청 상태.
    const fileItem: SubmissionChecklistItem = {
      ...ITEMS[0]!,
      submission: submission({
        id: 'submission-plan',
        status: 'CHANGES_REQUESTED',
        reviewComment: '파일을 교체해 주세요.',
        canResubmit: true,
      }),
    };
    const html = render({
      checklist: { ...CHECKLIST, items: [fileItem] },
      selectedMilestoneId: 'milestone-plan',
    });

    // Then
    expect(html).toContain('파일 제출은 현재 지원하지 않습니다.');
    expect(html).not.toContain('revision 2 제출');
    expect(html).not.toContain('type="file"');
  });

  it('미제출 선택 시 #115 제출 화면으로 안내한다', () => {
    const html = render({ selectedMilestoneId: 'milestone-final' });
    expect(html).toContain('아직 제출 전입니다');
    expect(html).toContain(
      '/programs/program-1/milestones/milestone-final/submit',
    );
  });
});

describe('체크리스트 로딩·오류 화면', () => {
  it('로딩은 Skeleton을 렌더한다', () => {
    const html = renderToStaticMarkup(<ChecklistSkeleton />);
    expect(html).toContain('체크리스트 불러오는 중');
    expect(html).toContain('animate-pulse');
  });

  it('실패는 메시지와 다시 시도 버튼을 렌더한다', () => {
    const html = renderToStaticMarkup(
      <ChecklistLoadFailure message="합성 네트워크 오류" onRetry={vi.fn()} />,
    );
    expect(html).toContain('체크리스트 불러오기 실패');
    expect(html).toContain('합성 네트워크 오류');
    expect(html).toContain('다시 시도');
  });
});
