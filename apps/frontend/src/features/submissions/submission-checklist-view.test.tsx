import { submissionUploadLimit } from '../../../test-support/submission-upload-limit';
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
import { SelectedMilestonePanel } from './components/submission-checklist-selected-panel';
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
  fileUpload: submissionUploadLimit(),
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

    // 바깥 section은 한 열 grid로 고정되고, 목록과 줄은 min-w-0로 줄어든다.
    expect(html.match(/grid-cols-\[minmax\(0,1fr\)\]/g)).toHaveLength(1);
    expect(html).toContain('data-slot="list-panel"');
    for (const row of html.split('data-slot="list-row"').slice(1)) {
      expect(row.slice(0, 400)).toContain('min-w-0');
    }
  });

  it('항목마다 카드를 반복하지 않고 공용 목록(ListPanel/ListRow) 한 장에 줄로 쌓는다', () => {
    // When
    const html = render();

    // Then: 목록 판은 하나, 줄은 마일스톤 수만큼.
    expect((html.match(/data-slot="list-panel"/g) ?? []).length).toBe(1);
    expect((html.match(/data-slot="list-row"/g) ?? []).length).toBe(
      ITEMS.length,
    );
    expect((html.match(/data-testid="checklist-row"/g) ?? []).length).toBe(
      ITEMS.length,
    );
    // 목록 줄은 카드가 아니다.
    expect(html).not.toContain('data-slot="card"');
  });

  it('상태 5종을 programs 화면과 같은 라벨로, 상태와 무관하게 한 줄에 하나씩 제출 내역 링크를 둔다', () => {
    // When
    const html = render();

    // Then: 5종 상태 라벨은 제출 상태 배지로만 나타난다.
    expect(html).toContain('제출 전');
    expect(html).toContain('제출됨');
    expect(html).toContain('승인');
    expect(html).toContain('보완 필요');
    expect(html).toContain('최종 반려');
    // 상태마다 이름이 바뀌던 버튼 모양 앵커는 사라졌다.
    expect(html).not.toContain('올리기');
    expect(html).not.toContain('다시 제출');
    expect(html).not.toContain('>보기<');
    // 줄마다 목적지를 이름으로 부르는 링크 하나.
    for (const item of ITEMS) {
      expect(html).toContain(
        `/programs/program-1/documents?milestoneId=${item.milestoneId}`,
      );
      expect(html).toContain(`id="submission-trigger-${item.milestoneId}"`);
      expect(html).toContain(`aria-label="${item.name} 제출 내역 열기"`);
    }
    expect((html.match(/documents\?milestoneId=/g) ?? []).length).toBe(
      ITEMS.length,
    );
  });

  it('제출 현황 머리에는 지금 할 일만 적고 뜻 없는 분수나 반복 문장을 적지 않는다', () => {
    // When — ITEMS 5개 중 보완 필요는 1건(중간 보고).
    const html = render();

    // Then
    expect(html).toContain('제출 현황');
    expect((html.match(/보완 필요 1건/g) ?? []).length).toBe(1);
    expect(html).not.toContain('4/5');
    expect(html).not.toContain('낼 서류');
    expect(html).not.toContain('여기에서 바로 냅니다');
    expect(html).not.toContain('내 제출물');
  });

  it('보완할 건이 없으면 머리에 건수를 아예 적지 않는다', () => {
    // Given: 검토 대기 하나만 있는 체크리스트.
    const demo = ITEMS[2];
    if (!demo) throw new Error('expected submitted checklist fixture');

    // When
    const html = render({ checklist: { ...CHECKLIST, items: [demo] } });

    // Then
    expect(html).toContain('제출 현황');
    expect(html).not.toContain('보완 필요');
    expect(html).not.toMatch(/\d+\/\d+/);
  });

  it('마감은 평범한 일정 글로, 심사 결과만 상태 배지로 구분해 적는다', () => {
    // Given: 마감이 지난 승인 항목 하나만.
    const approved = ITEMS[0];
    if (!approved) throw new Error('expected approved checklist fixture');

    // When
    const html = render({ checklist: { ...CHECKLIST, items: [approved] } });

    // Then: 마감 지남은 글이고 배지는 승인 하나뿐이라 「실패한 제출」로 읽히지 않는다.
    expect(html).toContain('마감 지남');
    expect(html).toContain('제출 상태: ');
    expect((html.match(/data-slot="status-badge"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-variant="approved"');
    expect(html).not.toContain('data-variant="rejected"');
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

describe('ChecklistRow 목적지 링크', () => {
  it.each([-1, 0, 1])(
    '마감 경계 %dms에도 보완 요청의 제출 내역 링크를 보존한다',
    (offset) => {
      const item = ITEMS[1];
      if (!item) throw new Error('expected revision fixture');
      const link = findLinkElement(
        ChecklistRow({
          programId: 'program-1',
          item,
          now: new Date(new Date(item.dueAt).getTime() + offset),
        }),
      );
      expect(link?.props.href).toBe(
        '/programs/program-1/documents?milestoneId=milestone-interim',
      );
    },
  );

  it('링크는 버튼 흘내내기가 아니라 이름이 곳 목적지인 앵커다', () => {
    // Given: 검토 대기 제출물 한 줄.
    const item = ITEMS[2];
    if (!item) throw new Error('expected submitted checklist fixture');

    // When
    const html = renderToStaticMarkup(
      <ChecklistRow programId="program-1" item={item} now={NOW} />,
    );

    // Then: 앵커 하나가 마일스톤 이름을 달고 서고, 버튼은 줄에 없다.
    expect((html.match(/<a /g) ?? []).length).toBe(1);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('role="button"');
    expect(html).toContain('aria-label="시연 영상 제출 내역 열기"');
    expect(html).toContain('>시연 영상</a>');
    expect(html).toContain('id="submission-trigger-milestone-demo"');
  });

  it('primary click은 상세 패널로 진입하고 modified click은 native Link 동작을 보존한다', () => {
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
  it('마감이 지난 미제출 마일스톤은 제출 자리를 열지 않고 그 사실만 적는다', () => {
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

    // Then: 링크도 버튼도 없고, 돌아올 포커스 자리만 남는다.
    expect(html).toContain('마감이 지나 새로 제출할 수 없습니다.');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<button');
    expect(html).not.toContain(
      'href="/programs/program-1/documents?milestoneId=',
    );
    expect(html).toContain(
      'id="submission-trigger-milestone-overdue-empty" tabindex="-1"',
    );
    expect(html).toContain('제출 전');
  });

  it('오늘 이미 지난 시각이 마감이면 제출 자리를 열지 않는다', () => {
    // Given: NOW(Seoul 07-24 12:00)보다 앞선 같은 날 09:00 마감. 달력일 차이는
    // 0이라 D-day 라벨은 '오늘 마감'이지만 서버는 이미 거절한다.
    const dueEarlierToday: SubmissionChecklistItem = {
      milestoneId: 'milestone-due-earlier-today',
      name: '오늘 오전 마감 서류',
      dueAt: '2026-07-24T00:00:00.000Z',
      submissionType: 'TEXT',
      submission: null,
    };
    const html = renderToStaticMarkup(
      <ChecklistRow programId="program-1" item={dueEarlierToday} now={NOW} />,
    );

    // Then: 라벨은 '오늘 마감'인 채로 제출 자리만 막힌다.
    expect(html).toContain('오늘 마감');
    expect(html).toContain('마감이 지나 새로 제출할 수 없습니다.');
    expect(html).not.toContain(
      'href="/programs/program-1/documents?milestoneId=',
    );
  });

  it('오늘 남은 시각이 마감이면 제출 내역 링크를 열어 둔다', () => {
    // Given: 같은 '오늘 마감'이되 NOW보다 뒤인 23:59:59 마감. 위 검사가 과잉
    // 교정으로 '오늘 마감'을 통째로 막지 않는지 함께 고정한다.
    const dueLaterToday: SubmissionChecklistItem = {
      milestoneId: 'milestone-due-later-today',
      name: '오늘 자정 마감 서류',
      dueAt: '2026-07-24T14:59:59.000Z',
      submissionType: 'TEXT',
      submission: null,
    };
    const html = renderToStaticMarkup(
      <ChecklistRow programId="program-1" item={dueLaterToday} now={NOW} />,
    );

    // Then
    expect(html).toContain('오늘 마감');
    expect(html).not.toContain('마감이 지나 새로 제출할 수 없습니다.');
    expect(html).toContain(
      'href="/programs/program-1/documents?milestoneId=milestone-due-later-today"',
    );
  });

  it('보완 요청 상태면 canResubmit이 false여도 보완 필요로 읽히고 제출 내역을 열 수 있다', () => {
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
    expect(html).toContain(
      'href="/programs/program-1/documents?milestoneId=milestone-changes-requested"',
    );
    expect(html).not.toContain('다시 제출');
  });

  it('승인된 제출물도 같은 제출 내역 링크 하나만 렌더한다', () => {
    const approved = ITEMS[0];
    if (!approved) throw new Error('expected approved checklist fixture');
    const html = renderToStaticMarkup(
      <ChecklistRow programId="program-1" item={approved} now={NOW} />,
    );

    // 마감이 지났지만 이미 승인된 제출물이라 읽는 길을 닫지 않는다.
    expect(html).toContain('마감 지남');
    expect(html).toContain(
      'href="/programs/program-1/documents?milestoneId=milestone-plan"',
    );
    expect(html).not.toContain('마감이 지나 새로 제출할 수 없습니다.');
    expect(html).not.toContain('다시 제출');
  });

  it('마감 전 미제출 마일스톤은 제출 내역 링크가 열려 있다', () => {
    const html = render({ selectedMilestoneId: null });
    expect(html).toContain('제출 전');
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
    // 심사 결과가 지금 상태와 같으면 배지가 한 번 말한 것으로 끝난다.
    expect(html).not.toContain('최근 검토 결과');
    expect(html).toContain('보완 필요');
    expect(html).toContain('수정한 뒤 재제출할 수 있습니다.');
    expect(html).toContain('현재 제출본');
    expect(html).toContain('id="submission-text"'); // #115 유형별 입력 재사용
    expect(html).toContain('id="resubmission-comment"');
    expect(html).toContain('제출본 2번 제출');
    expect(html).toContain('취소');
    // #354 — 내부 용어가 학생 화면으로 새어 나오지 않아야 한다.
    expect(html).not.toMatch(/revision/i);
  });

  it('검토 대기 선택 시 제출본 번호와 읽기 전용 상태를 보여주고 달리 보이는 버튼을 두지 않는다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-demo' });

    // Then: 상태는 배지 하나, 제출본 번호는 검토 메타 한 줄로 한 번만 적는다.
    expect(html).toContain('현재 제출본');
    expect((html.match(/1번/g) ?? []).length).toBe(1);
    expect(html).toContain(
      '교직원 검토가 끝날 때까지는 제출 내용을 바꿀 수 없습니다',
    );
    expect(html).toContain('disabled=""');
    // 누를 수 없는 「검토 대기 중」 버튼은 상태를 버튼 모양으로 위장했다.
    expect(html).not.toContain('검토 대기 중');
    expect(html).not.toContain('제출본 2번 제출');
    expect(html).not.toMatch(/revision/i);
  });

  it('승인 선택 시 같은 승인을 문장으로 되풀이하지 않고 검토 기록만 보여준다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-plan' });

    // Then
    expect(html).not.toContain('승인되었습니다');
    expect(html).toContain('data-variant="approved"');
    expect(html).toContain('검토 시각');
    // 패널 안에서 「승인」은 배지 한 번뿐 — 결과 dl로 또 적지 않는다.
    const panel = html.slice(html.indexOf('data-testid="milestone-panel"'));
    expect((panel.match(/승인/g) ?? []).length).toBe(1);
    expect(panel).not.toContain('최근 검토 결과');
    // 제출본 번호는 여전히 한 번은 분명하게 보인다.
    expect(html).toContain('현재 제출본');
    expect((html.match(/1번/g) ?? []).length).toBe(1);
    expect(html).toContain('data-testid="milestone-document-current-files"');
    expect(html).not.toMatch(/revision/i);
  });

  it('최종 반려 선택 시 코멘트 읽기 전용이고 재제출 폼이 없다', () => {
    // When
    const html = render({ selectedMilestoneId: 'milestone-retro' });

    // Then
    expect(html).toContain('중복 제출로 최종 반려되었습니다.');
    expect(html).toContain('최종 반려된 제출은 재제출할 수 없습니다.');
    expect(html).toContain('최종 반려');
    expect(html).not.toContain('최근 검토 결과');
    expect(html).toContain('검토 시각');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('id="submission-text"');
  });

  it('지난 심사가 지금 상태와 다르면 그 결과를 이름으로 남긴다', () => {
    // Given: 보완 요청을 받아 다시 낸 제출본이 검토 대기인 상태.
    const demo = ITEMS[2];
    if (!demo) throw new Error('expected submitted checklist fixture');
    const reReviewed: SubmissionChecklistItem = {
      ...demo,
      submission: submission({
        id: 'submission-demo',
        status: 'SUBMITTED',
        currentRevision: 2,
        decision: 'CHANGES_REQUESTED',
        reviewComment: '실행 화면 캡처를 추가해 주세요.',
        lastReviewedAt: '2026-07-23T01:00:00.000Z',
      }),
    };

    // When
    const html = render({
      checklist: { ...CHECKLIST, items: [reReviewed] },
      selectedMilestoneId: 'milestone-demo',
    });

    // Then: 지금 상태(제출됨)와 지난 심사(보완 요청)는 같은 말이 아니라 둘 다 적는다.
    expect(html).toContain('최근 검토 결과');
    expect(html).toContain('보완 요청');
    expect(html).toContain('교직원 코멘트');
    expect(html).toContain('실행 화면 캡처를 추가해 주세요.');
    expect(html).toContain('검토 시각');
    expect(html).toContain('현재 제출본');
    expect(html).toContain('2번');
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
    expect(html).toContain('PDF, HWP, ZIP');
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

describe('SelectedMilestonePanel 다이얼로그 문맥', () => {
  /** 닫기 핸들러를 넘기면 뷰가 패널을 SubmissionDialog 안에 넣는다(상위 뷰 참조). */
  function renderPanel(
    item: SubmissionChecklistItem,
    overrides: { readonly onCloseSelected?: () => void } = {},
  ): string {
    return renderToStaticMarkup(
      <SelectedMilestonePanel
        fileUpload={submissionUploadLimit()}
        programId="program-1"
        item={item}
        input={{ file: null, text: '' }}
        comment=""
        errors={{}}
        fileError={null}
        submitting={false}
        submissionPhase={null}
        {...handlers}
        {...overrides}
      />,
    );
  }

  it('창 안에서는 창 제목이 말한 마일스톤 이름을 카드 제목으로 다시 적지 않는다', () => {
    const approved = ITEMS[0];
    if (!approved) throw new Error('expected approved checklist fixture');

    // When: 닫기 핸들러가 있는 문맥(= 다이얼로그).
    const html = renderPanel(approved, { onCloseSelected: vi.fn() });

    // Then: 이름도 카드 테두리도 반복되지 않고, 상태 배지는 하나 남는다.
    expect(html).not.toContain(approved.name);
    expect(html).not.toContain('data-slot="card"');
    expect((html.match(/data-slot="status-badge"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-testid="milestone-panel"');
    // 검토 기록과 현재 파일 영역은 그대로 남는다.
    expect(html).toContain('검토 시각');
    expect(html).toContain('data-testid="milestone-document-current-files"');
  });

  it('닫기가 없는 단독 사용처에서는 제목 있는 카드를 그대로 유지한다', () => {
    const approved = ITEMS[0];
    if (!approved) throw new Error('expected approved checklist fixture');

    // When: 닫기 핸들러 없음(= 창 밖 본문 배치).
    const html = renderPanel(approved);

    // Then
    expect(html).toContain(approved.name);
    expect(html).toContain('data-slot="card"');
  });

  it('창 안의 검토 대기 패널에도 동작 없는 상태 버튼은 없다', () => {
    const submitted = ITEMS[2];
    if (!submitted) throw new Error('expected submitted checklist fixture');

    // When
    const html = renderPanel(submitted, { onCloseSelected: vi.fn() });

    // Then
    expect(html).not.toContain('검토 대기 중');
    expect(html).not.toContain('<button type="button" disabled');
    expect(html).toContain('현재 제출본');
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
