import { renderToStaticMarkup } from 'react-dom/server';
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ChecklistLoadFailure,
  ChecklistParticipationRequired,
  ChecklistSkeleton,
  SubmissionChecklistView,
  type SubmissionChecklistViewProps,
} from './components/submission-checklist-view';
import { ChecklistRow } from './components/submission-checklist-row';
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
    decision: null,
    lastReviewedAt: null,
    reviewComment: null,
    canResubmit: false,
    file: null,
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
      decision: 'APPROVED',
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
      decision: 'CHANGES_REQUESTED',
      reviewComment: '실행 화면 캡처를 추가해 주세요.',
      lastReviewedAt: '2026-07-23T01:00:00.000Z',
      canResubmit: true,
    }),
  },
  {
    milestoneId: 'milestone-demo',
    name: '시연 영상',
    dueAt: '2026-07-30T14:59:59.000Z',
    submissionType: 'TEXT',
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
      decision: 'REJECTED',
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
  onFileChange: vi.fn(),
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
      input={{ file: null, text: '' }}
      comment=""
      errors={{}}
      fileError={null}
      serverError={null}
      staleNotice={null}
      toastMessage={null}
      submitting={false}
      submissionPhase={null}
      {...handlers}
      {...overrides}
    />,
  );
}

type LinkClickEvent = {
  readonly button: number;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented: boolean;
  preventDefault: () => void;
  wasPrevented: () => boolean;
};

type LinkElementProps = {
  readonly children?: ReactNode;
  readonly href?: string;
  readonly onClick?: (event: LinkClickEvent) => void;
};

function linkClickEvent(
  overrides: Partial<Omit<LinkClickEvent, 'preventDefault' | 'wasPrevented'>>,
): LinkClickEvent {
  let prevented = overrides.defaultPrevented ?? false;
  return {
    button: overrides.button ?? 0,
    metaKey: overrides.metaKey ?? false,
    altKey: overrides.altKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault: () => {
      prevented = true;
    },
    wasPrevented: () => prevented,
  };
}

function findLinkElement(
  node: ReactNode,
): ReactElement<LinkElementProps> | null {
  if (!isValidElement<LinkElementProps>(node)) return null;
  if (node.props.href?.includes('/documents?milestoneId=') === true)
    return node;
  for (const child of Children.toArray(node.props.children)) {
    const link = findLinkElement(child);
    if (link !== null) return link;
  }
  return null;
}

describe('SubmissionChecklistView 체크리스트', () => {
  it('프로그램 상세의 레거시 체크리스트 앵커를 유지한다', () => {
    const html = render();
    expect(html).toContain('id="milestones"');
  });

  it('모바일에서 긴 안내와 파일명이 목록 폭을 넓히지 않는다', () => {
    const html = render();

    expect(html.match(/grid-cols-\[minmax\(0,1fr\)\]/g)).toHaveLength(3);
  });

  it('상태 5종을 programs 화면과 같은 라벨로, 보완 필요 행에는 재제출 진입 동작을 렌더한다', () => {
    // When
    const html = render();

    // Then: 5종 상태 라벨.
    expect(html).toContain('제출 전');
    expect(html).toContain('제출됨');
    expect(html).toContain('승인');
    expect(html).toContain('보완 필요');
    expect(html).toContain('최종 반려');
    // 행동 버튼: 미제출 → 올리기, 재제출 가능 → 다시 제출, 나머지(읽기전용) → 보기.
    expect(html).toContain(
      '/programs/program-1/documents?milestoneId=milestone-final',
    );
    expect(html).toContain('id="submission-trigger-milestone-final"');
    expect(html).toContain('올리기');
    expect(html).toContain('다시 제출');
    expect(html).toContain('보기');
    expect(html).toContain(
      '/programs/program-1/documents?milestoneId=milestone-interim',
    );
  });

  it('낼 서류 건수 중 제출 건수를 요약해 보여준다(좌측 패널과 같은 규칙)', () => {
    // When — ITEMS 5개 중 submission!==null인 항목 4개(기획서/중간보고/시연/회고).
    const html = render();

    // Then
    expect(html).toContain('내 제출물');
    expect(html).toContain('4/5');
    expect(html).toContain('낼 서류 5건 중 4건 제출 · 보완 필요 1건');
    expect(html).toContain('단계별 제출물을 확인하고 여기에서 바로 냅니다.');
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
        '제출본 2번을 제출했습니다. 검토 대기 상태로 전환되었습니다.',
      staleNotice:
        '다른 곳에서 제출 상태가 바뀌어 최신 상태를 다시 불러왔습니다.',
      serverError: '재제출하지 못했습니다.',
    });
    expect(html).toContain('role="status"');
    expect(html).toContain('제출본 2번을 제출했습니다');
    expect(html).toContain('제출 상태가 변경되었습니다');
    expect(html).toContain('재제출 실패');
    expect(html).toContain('재제출하지 못했습니다.');
  });
});

describe('ChecklistRow 제출 CTA', () => {
  it('다시 제출 primary click은 상세 재제출 패널로 진입하고 modified click은 native Link 동작을 보존한다', () => {
    // Given
    const item = ITEMS[1];
    if (!item) throw new Error('expected unsubmitted checklist item fixture');
    const onSelectMilestone = vi.fn();
    const link = findLinkElement(
      ChecklistRow({
        programId: 'program-1',
        item,
        now: NOW,
        onSelectMilestone,
      }),
    );
    if (link?.props.onClick === undefined) {
      throw new Error('expected row CTA click handler');
    }

    const modifiedClick = linkClickEvent({ metaKey: true });
    link.props.onClick(modifiedClick);

    expect(modifiedClick.wasPrevented()).toBe(false);
    expect(onSelectMilestone).not.toHaveBeenCalled();

    const ordinaryClick = linkClickEvent({});
    link.props.onClick(ordinaryClick);

    expect(ordinaryClick.wasPrevented()).toBe(true);
    expect(onSelectMilestone).toHaveBeenCalledTimes(1);
    expect(onSelectMilestone).toHaveBeenCalledWith('milestone-interim');
  });
});

describe('ChecklistRow 업로드 가능 여부', () => {
  it('마감이 지난 미제출 마일스톤은 올리기 버튼을 비활성화한다', () => {
    // Given: dueAt이 NOW(2026-07-24 Seoul)보다 지난 미제출 마일스톤.
    const overdueUnsubmitted: SubmissionChecklistItem = {
      milestoneId: 'milestone-overdue-empty',
      name: '지난 마감 서류',
      dueAt: '2026-07-20T14:59:59.000Z',
      submissionType: 'TEXT',
      submission: null,
    };
    const html = renderToStaticMarkup(
      <ChecklistRow
        programId="program-1"
        item={overdueUnsubmitted}
        now={NOW}
      />,
    );

    // Then
    expect(html).toContain('올리기');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain(
      'href="/programs/program-1/documents?milestoneId=',
    );
  });

  it('보완 요청 상태면 canResubmit이 false여도 다시 제출 동작을 렌더한다', () => {
    const changesRequested: SubmissionChecklistItem = {
      milestoneId: 'milestone-changes-requested',
      name: '보완 요청 서류',
      dueAt: '2026-07-27T14:59:59.000Z',
      submissionType: 'TEXT',
      submission: submission({
        id: 'submission-changes-requested',
        status: 'CHANGES_REQUESTED',
        decision: 'CHANGES_REQUESTED',
        canResubmit: false,
      }),
    };
    const html = renderToStaticMarkup(
      <ChecklistRow programId="program-1" item={changesRequested} now={NOW} />,
    );

    expect(html).toContain('보완 필요');
    expect(html).toContain('다시 제출');
  });

  it('승인된 제출물은 다시 제출 동작을 렌더하지 않는다', () => {
    const approved = ITEMS[0];
    if (!approved) throw new Error('expected approved checklist fixture');
    const html = renderToStaticMarkup(
      <ChecklistRow programId="program-1" item={approved} now={NOW} />,
    );

    expect(html).toContain('보기');
    expect(html).not.toContain('다시 제출');
  });

  it('마감 전 미제출 마일스톤은 올리기 버튼이 활성화된 링크다', () => {
    const html = render({ selectedMilestoneId: null });
    expect(html).toContain('올리기');
    expect(html).toContain(
      'href="/programs/program-1/documents?milestoneId=milestone-final"',
    );
  });
});

describe('SubmissionChecklistView 선택 패널', () => {
  it('보완 요청 판정과 코멘트, 재제출 경로를 보여준다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-interim' });

    // Then
    expect(html).toContain('교직원 코멘트');
    expect(html).toContain('실행 화면 캡처를 추가해 주세요.');
    expect(html).toContain('결과');
    expect(html).toContain('보완 요청');
    expect(html).toContain('수정한 뒤 재제출할 수 있습니다.');
    expect(html).toContain('현재 제출본');
    expect(html).toContain('id="submission-text"'); // #115 유형별 입력 재사용
    expect(html).toContain('id="resubmission-comment"');
    expect(html).toContain('제출본 2번 제출');
    expect(html).toContain('취소');
    // #354 — 내부 용어가 학생 화면으로 새어 나오지 않아야 한다.
    expect(html).not.toMatch(/revision/i);
  });

  it('검토 대기 선택 시 제출본 번호를 보여주고 입력을 비활성화한다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-demo' });

    // Then
    expect(html).toContain('제출본 1번이 검토 대기 중입니다');
    expect(html).toContain('disabled=""');
    expect(html).toContain('검토 대기 중');
    expect(html).not.toContain('제출본 2번 제출');
    expect(html).not.toMatch(/revision/i);
  });

  it('승인 선택 시 완료 배지와 검토 시각을 보여준다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-plan' });

    // Then
    expect(html).toContain('제출본 1번이 승인되었습니다');
    expect(html).toContain('data-variant="approved"');
    expect(html).toContain('검토 시각');
    expect(html).toContain('결과');
    expect(html).toContain('승인');
    expect(html).toContain('data-testid="milestone-document-current-files"');
    expect(html).not.toMatch(/revision/i);
  });

  it('최종 반려 선택 시 코멘트 읽기 전용이고 재제출 폼이 없다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-retro' });

    // Then
    expect(html).toContain('중복 제출로 최종 반려되었습니다.');
    expect(html).toContain('최종 반려된 제출은 재제출할 수 없습니다.');
    expect(html).toContain('결과');
    expect(html).toContain('반려');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('id="submission-text"');
  });

  it('FILE changes-requested milestones render the replacement file resubmission form', () => {
    // Given: FILE 마일스톤이 보완 요청 상태.
    const planItem = ITEMS[0];
    if (!planItem) throw new Error('expected file checklist fixture');
    const fileItem: SubmissionChecklistItem = {
      ...planItem,
      submission: submission({
        id: 'submission-plan',
        status: 'CHANGES_REQUESTED',
        decision: 'CHANGES_REQUESTED',
        reviewComment: '파일을 교체해 주세요.',
        canResubmit: true,
      }),
    };
    const html = render({
      checklist: { ...CHECKLIST, items: [fileItem] },
      selectedMilestoneId: 'milestone-plan',
    });

    // Then
    expect(html).toContain('type="file"');
    expect(html).toContain('PDF, HWP, JPG, PNG, ZIP');
    expect(html).toContain('제출본 2번 제출');
    expect(html).not.toMatch(/revision/i);
  });

  it('미제출 선택 시 #115 제출 화면으로 안내한다', () => {
    const html = render({ selectedMilestoneId: 'milestone-final' });
    expect(html).toContain('아직 제출 전입니다');
    expect(html).toContain(
      '/programs/program-1/documents?milestoneId=milestone-final',
    );
  });

  it('백그라운드 갱신 실패를 기존 체크리스트와 함께 보여준다', () => {
    const html = render({
      refreshError: '일시적으로 최신 상태를 불러오지 못했습니다.',
      onRefresh: vi.fn(),
    });
    expect(html).toContain('제출 상태 갱신 실패');
    expect(html).toContain('일시적으로 최신 상태를 불러오지 못했습니다.');
    expect(html).toContain('기획서 제출');
    expect(html).toContain('다시 시도');
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

describe('참여자가 아닌 학생의 서류 화면(#1099)', () => {
  const html = renderToStaticMarkup(
    <ChecklistParticipationRequired programId="program-1" />,
  );

  it('빨간 실패가 아니라 「아직 참여자가 아닙니다」 상태로 읽힌다', () => {
    expect(html).toContain('아직 참여자가 아닙니다');
    expect(html).toContain(
      '승인된 신청이 있는 참여자만 제출물을 볼 수 있습니다.',
    );
    expect(html).not.toContain('체크리스트 불러오기 실패');
    expect(html).not.toContain('다시 시도');
    expect(html).not.toContain('data-slot="alert"');
    expect(html).not.toContain('role="alert"');
  });

  it('다음 행동으로 가는 링크가 DOM에 있다', () => {
    // 이 결함의 증상 중 하나가 「실패 화면 DOM에 링크(a)가 하나도 없다」였다.
    expect(html).toContain('href="/programs/program-1/apply"');
    expect(html).toContain('href="/programs/program-1"');
    expect((html.match(/<a /g) ?? []).length).toBe(2);
  });
});
