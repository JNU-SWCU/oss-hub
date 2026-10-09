import { describe, expect, it } from 'vitest';

import { dashboardItem, dashboardMilestone } from './fixtures';
import { splitDashboardItems, submissionActionLabel } from './sections';

const active = (
  key: string,
  dueAt: string,
  status: Parameters<typeof dashboardMilestone>[1] = 'NOT_SUBMITTED',
) => dashboardItem(key, 'APPROVED', dashboardMilestone(dueAt, status));

describe('splitDashboardItems', () => {
  it('진행 중·마친 프로그램·신청 상태로 나누고 진행 중은 마감 순, 같은 마감은 받은 순서를 지킨다', () => {
    const later = active('later', '2026-08-10T23:59:59+09:00');
    const tieFirst = active('tie-first', '2026-08-01T23:59:59+09:00');
    const tieSecond = active('tie-second', '2026-08-01T14:59:59Z');
    const done = dashboardItem('done', 'APPROVED');
    const submitted = dashboardItem('submitted', 'SUBMITTED');
    const rejected = dashboardItem('rejected', 'REJECTED');

    const sections = splitDashboardItems([
      submitted,
      later,
      done,
      tieFirst,
      rejected,
      tieSecond,
    ]);

    expect(sections.active).toEqual([tieFirst, tieSecond, later]);
    expect(sections.done).toEqual([done]);
    expect(sections.applying).toEqual([submitted, rejected]);
  });

  it('주 행동은 서류를 내거나 다시 내야 하는 진행 중 가운데 마감이 가장 이른 하나다', () => {
    const reviewing = active(
      'reviewing',
      '2026-07-24T23:59:59+09:00',
      'SUBMITTED',
    );
    const resubmit = active(
      'resubmit',
      '2026-07-27T23:59:59+09:00',
      'CHANGES_REQUESTED',
    );
    const fresh = active('fresh', '2026-07-30T23:59:59+09:00');

    expect(
      splitDashboardItems([fresh, resubmit, reviewing]).primaryApplicationId,
    ).toBe(resubmit.applicationId);
    expect(splitDashboardItems([fresh, reviewing]).primaryApplicationId).toBe(
      fresh.applicationId,
    );
  });

  it('낼 서류가 없으면 주 행동을 두지 않는다', () => {
    expect(
      splitDashboardItems([
        active('reviewing', '2026-07-24T23:59:59+09:00', 'SUBMITTED'),
        active('final', '2026-07-25T23:59:59+09:00', 'REJECTED'),
        dashboardItem('done', 'APPROVED'),
        dashboardItem('submitted', 'SUBMITTED'),
      ]).primaryApplicationId,
    ).toBeNull();
  });
});

describe('submissionActionLabel', () => {
  it.each([
    ['NOT_SUBMITTED', '서류 내기'],
    ['CHANGES_REQUESTED', '다시 내기'],
    ['SUBMITTED', '제출 현황'],
    ['APPROVED', '제출 현황'],
    ['REJECTED', '제출 현황'],
  ] as const)('다음 마일스톤이 %s이면 %s 버튼을 단다', (status, label) => {
    expect(submissionActionLabel(status)).toBe(label);
  });
});
