import { QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../../../../test-support/render-with-query';
import { ProgramMilestones } from '../../catalog/program-detail-view';
import type { ProgramDetail, ProgramMilestone } from '../../catalog/dto';

const NOW = new Date('2026-11-17T15:00:00+09:00');

function milestoneOf(
  id: string,
  name: string,
  dueAt: string,
  dDay: number,
  overrides: Partial<ProgramMilestone> = {},
): ProgramMilestone {
  return {
    id,
    name,
    dueAt,
    dDay,
    description: null,
    submissionItemCount: 1,
    viewerSubmissionStatus: null,
    applicationSubmissionSummary: null,
    ...overrides,
  };
}

function submitted(count: number, total: number) {
  return {
    notSubmitted: total - count,
    submitted: count,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    total,
  };
}

const MILESTONES = [
  milestoneOf('m1', '팀 구성·주제 확정', '2026-11-06T18:00:00+09:00', -11, {
    description: '팀 이름을 정리해 제출하세요.',
  }),
  milestoneOf('m2', '설계 문서', '2026-11-13T18:00:00+09:00', -4),
  milestoneOf('m3', '중간 발표 자료', '2026-11-27T18:00:00+09:00', 10, {
    description: 'PDF로 제출합니다.',
  }),
  milestoneOf('m4', '최종 보고서', '2026-12-11T18:00:00+09:00', 24),
  milestoneOf('m5', '최종 발표회', '2026-12-18T14:00:00+09:00', 31, {
    submissionItemCount: 0,
  }),
] as const;

const STAFF_SUMMARIES = [
  {
    notSubmitted: 0,
    submitted: 1,
    approved: 4,
    changesRequested: 1,
    rejected: 0,
    total: 6,
  },
  submitted(5, 6),
  submitted(2, 6),
  submitted(0, 6),
  null,
] as const;

const STUDENT_STATUSES = [
  'APPROVED',
  'CHANGES_REQUESTED',
  'NOT_SUBMITTED',
  'NOT_SUBMITTED',
  null,
] as const;

const STAFF_MILESTONES = MILESTONES.map((milestone, index) => ({
  ...milestone,
  applicationSubmissionSummary: STAFF_SUMMARIES[index],
}));

const STUDENT_MILESTONES = MILESTONES.map((milestone, index) => ({
  ...milestone,
  viewerSubmissionStatus: STUDENT_STATUSES[index],
}));

function programWith(
  milestones: readonly ProgramMilestone[],
  viewer: ProgramDetail['viewer'],
): ProgramDetail {
  return {
    id: 'program-1',
    name: '합성 개발 캠프',
    organizers: ['운영기관'],
    trackType: 'EXTRACURRICULAR',
    applicationTemplateKey: 'basic',
    description: '프로그램 설명',
    repositoryProvisioningEnabled: true,
    applicationPeriod: {
      startsAt: '2026-10-06T00:00:00+09:00',
      endsAt: '2026-10-24T23:59:59+09:00',
    },
    viewer,
    milestones: [...milestones],
  };
}

const STAFF = { role: 'STAFF', applicationStatus: null } as const;
const APPROVED_STUDENT = {
  role: 'STUDENT',
  applicationStatus: 'APPROVED',
} as const;

function renderSection(program: ProgramDetail): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <QueryClientProvider client={createTestQueryClient()}>
      <ProgramMilestones program={program} />
    </QueryClientProvider>,
  );
  const section = host.querySelector<HTMLElement>('#milestones');
  if (section === null) throw new TypeError('마일스톤 영역을 찾지 못했습니다.');
  return section;
}

function stepsOf(section: HTMLElement): readonly HTMLElement[] {
  return [
    ...section.querySelectorAll<HTMLElement>('[data-testid="milestone-group"]'),
  ];
}

function rowsOf(section: HTMLElement): readonly HTMLElement[] {
  return [
    ...section.querySelectorAll<HTMLElement>('[data-testid="milestone-row"]'),
  ];
}

function deadlinesOf(section: HTMLElement): readonly (string | null)[] {
  return rowsOf(section).map(
    (row) => row.querySelector('time')?.parentElement?.textContent ?? null,
  );
}

function detailOf(step: HTMLElement): HTMLElement | null {
  return step.querySelector('[data-testid="milestone-detail"]');
}

function linksOf(scope: HTMLElement): readonly (readonly [string, string])[] {
  return [...scope.querySelectorAll('a')].map(
    (anchor) =>
      [anchor.textContent ?? '', anchor.getAttribute('href') ?? ''] as const,
  );
}

function occurrences(section: HTMLElement, text: string): number {
  return (section.textContent ?? '').split(text).length - 1;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('마일스톤 진행 타임라인', () => {
  it('마감이 지난 단계와 지금 단계와 남은 단계를 순서대로 구분한다', () => {
    const steps = stepsOf(renderSection(programWith(STAFF_MILESTONES, STAFF)));

    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([
      null,
      null,
      'step',
      null,
      null,
    ]);
  });

  it('마감 칸은 날짜 뒤에 남은 날을 한 줄로 잇고 지난 단계에는 마감이라고 적는다', () => {
    const section = renderSection(programWith(STAFF_MILESTONES, STAFF));

    expect(deadlinesOf(section)).toEqual([
      '11.06 18:00 · 마감',
      '11.13 18:00 · 마감',
      '11.27 18:00 · D-10',
      '12.11 18:00 · D-24',
      '12.18 14:00 · D-31',
    ]);
  });

  it('마감 사흘 전부터 당일까지만 남은 날을 임박 색으로 적는다', () => {
    const section = renderSection(
      programWith(
        [
          milestoneOf('d0', '오늘 자정', '2026-11-17T23:59:59+09:00', 0),
          milestoneOf('d3', '사흘 뒤', '2026-11-20T18:00:00+09:00', 3),
          milestoneOf('d4', '나흘 뒤', '2026-11-21T18:00:00+09:00', 4),
        ],
        STAFF,
      ),
    );

    expect(deadlinesOf(section)).toEqual([
      '11.17 23:59 · D-Day',
      '11.20 18:00 · D-3',
      '11.21 18:00 · D-4',
    ]);
    expect(
      rowsOf(section).map(
        (row) =>
          row.querySelector('.text-status-pending-fg')?.textContent ?? null,
      ),
    ).toEqual(['D-Day', 'D-3', null]);
  });

  it('교직원의 한 줄은 번호, 이름, 마감, 제출 현황, 서류 수합 순서로 한 번씩만 읽힌다', () => {
    const section = renderSection(programWith(STAFF_MILESTONES, STAFF));

    expect(rowsOf(section).map((row) => row.textContent)).toEqual([
      '1팀 구성·주제 확정11.06 18:00 · 마감제출 6/6미제출 0 · 승인 4 · 보완 1 · 반려 0서류 수합',
      '2설계 문서11.13 18:00 · 마감제출 5/6미제출 1 · 승인 0 · 보완 0 · 반려 0서류 수합',
      '3중간 발표 자료11.27 18:00 · D-10제출 2/6미제출 4 · 승인 0 · 보완 0 · 반려 0서류 수합',
      '4최종 보고서12.11 18:00 · D-24제출 0/6미제출 6 · 승인 0 · 보완 0 · 반려 0서류 수합',
      '5최종 발표회12.18 14:00 · D-31제출 없음',
    ]);
  });

  it.each([
    ['교직원', programWith(STAFF_MILESTONES, STAFF)],
    ['학생', programWith(STUDENT_MILESTONES, APPROVED_STUDENT)],
  ] as const)(
    '%s에게 지금 단계만 펼쳐 두고 지난 단계와 남은 단계는 접어 둔다',
    (_viewer, program) => {
      const steps = stepsOf(renderSection(program));

      expect(
        steps.map((step) => detailOf(step)?.getAttribute('data-state') ?? null),
      ).toEqual(['closed', 'closed', 'open', 'closed', null]);
    },
  );

  it('공지는 펼치는 구역 안에 두고 줄에는 적지 않는다', () => {
    const section = renderSection(programWith(STAFF_MILESTONES, STAFF));

    expect(
      section.querySelectorAll('[data-testid="milestone-row"] [role="note"]'),
    ).toHaveLength(0);
    expect(
      stepsOf(section).map(
        (step) =>
          detailOf(step)?.querySelector('[role="note"]')?.textContent ?? null,
      ),
    ).toEqual([
      '팀 이름을 정리해 제출하세요.',
      null,
      'PDF로 제출합니다.',
      null,
      null,
    ]);
  });

  it('지난 단계에 남은 미제출만 눈에 띄게 적는다', () => {
    const section = renderSection(programWith(STAFF_MILESTONES, STAFF));

    expect(
      stepsOf(section).map(
        (step) =>
          step.querySelector('.text-destructive-on-tint')?.textContent ?? null,
      ),
    ).toEqual([null, '미제출 1', null, null, null]);
    expect(section.textContent).not.toMatch(/\d\/\d+\s*팀/);
  });

  it('제출 진행 막대는 지금 단계에만 두고 제출 수와 이어 읽힌다', () => {
    const section = renderSection(programWith(STAFF_MILESTONES, STAFF));
    const bars = [...section.querySelectorAll('[role="progressbar"]')];

    expect(bars).toHaveLength(1);
    const [bar] = bars;
    expect(bar.closest('[data-testid="milestone-group"]')).toBe(
      stepsOf(section)[2],
    );
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('6');
    const labelId = bar.getAttribute('aria-labelledby');
    expect(labelId).not.toBeNull();
    expect(section.querySelector(`#${labelId ?? ''}`)?.textContent).toBe(
      '제출 2/6',
    );
  });

  it('교직원의 서류 수합 입구를 제출 항목이 있는 단계마다 둔다', () => {
    const steps = stepsOf(renderSection(programWith(STAFF_MILESTONES, STAFF)));

    expect(steps.map((step) => linksOf(step))).toEqual([
      [['서류 수합', '/programs/program-1/milestones/m1/documents']],
      [['서류 수합', '/programs/program-1/milestones/m2/documents']],
      [['서류 수합', '/programs/program-1/milestones/m3/documents']],
      [['서류 수합', '/programs/program-1/milestones/m4/documents']],
      [],
    ]);
  });

  it('몇 개인지 세는 문구를 제목 옆에 두지 않는다', () => {
    const section = renderSection(programWith(STAFF_MILESTONES, STAFF));

    expect(
      section.querySelector('[data-slot="section-heading"]')?.textContent,
    ).toBe('마일스톤');
    expect(section.textContent).not.toMatch(/\d+개/);
  });

  it('낼 팀이 없는 단계에는 0/0 대신 제출 없음이라고 적는다', () => {
    const section = renderSection(
      programWith(
        STAFF_MILESTONES.map((milestone) => ({
          ...milestone,
          applicationSubmissionSummary:
            milestone.applicationSubmissionSummary === null
              ? null
              : submitted(0, 0),
        })),
        STAFF,
      ),
    );

    expect(section.textContent).not.toContain('0/0');
    expect(section.querySelector('[role="progressbar"]')).toBeNull();
    expect(
      rowsOf(section).map((row) =>
        (row.textContent ?? '').includes('제출 없음'),
      ),
    ).toEqual([true, true, true, true, true]);
  });

  it('학생의 한 줄은 번호, 이름, 마감, 내 제출 상태, 제출 입구 순서로 한 번씩만 읽힌다', () => {
    const section = renderSection(
      programWith(STUDENT_MILESTONES, APPROVED_STUDENT),
    );

    expect(rowsOf(section).map((row) => row.textContent)).toEqual([
      '1팀 구성·주제 확정11.06 18:00 · 마감승인',
      '2설계 문서11.13 18:00 · 마감보완 필요다시 제출',
      '3중간 발표 자료11.27 18:00 · D-10미제출제출하기',
      '4최종 보고서12.11 18:00 · D-24미제출제출하기',
      '5최종 발표회12.18 14:00 · D-31제출 없음',
    ]);
  });

  it('학생의 제출 입구는 제출 화면으로 잇고, 지금 단계만 채워서 강조한다', () => {
    const steps = stepsOf(
      renderSection(programWith(STUDENT_MILESTONES, APPROVED_STUDENT)),
    );

    expect(steps.map((step) => linksOf(step))).toEqual([
      [],
      [['다시 제출', '/programs/program-1/documents?milestoneId=m2']],
      [['제출하기', '/programs/program-1/documents?milestoneId=m3']],
      [['제출하기', '/programs/program-1/documents?milestoneId=m4']],
      [],
    ]);
    expect(
      steps.map(
        (step) => step.querySelector('a')?.getAttribute('data-variant') ?? null,
      ),
    ).toEqual([null, 'outline', 'default', 'outline', null]);
  });

  it('학생의 줄에는 팀 전체 제출 수와 진행 막대를 보여주지 않는다', () => {
    const section = renderSection(
      programWith(STUDENT_MILESTONES, APPROVED_STUDENT),
    );

    expect(section.querySelector('[role="progressbar"]')).toBeNull();
    expect(
      rowsOf(section).map((row) => /제출 \d+\/\d+/.test(row.textContent ?? '')),
    ).toEqual([false, false, false, false, false]);
  });

  it.each([
    [null, '이 프로그램에 신청해야 제출할 수 있습니다.'],
    [
      'SUBMITTED' as const,
      '신청 승인을 기다리는 중입니다. 승인되면 제출할 수 있습니다.',
    ],
  ])(
    '신청 상태 %s 인 학생에게는 제출 입구 대신 이유를 한 번만 적는다',
    (applicationStatus, notice) => {
      const section = renderSection(
        programWith(MILESTONES, { role: 'STUDENT', applicationStatus }),
      );

      expect(occurrences(section, notice)).toBe(1);
      expect(linksOf(section)).toEqual([]);
      expect(section.textContent).not.toContain('미제출');
    },
  );

  it('신청이 반려된 학생에게는 제출 상태를 숨기고 이유를 한 번만 적는다', () => {
    const section = renderSection(
      programWith(STUDENT_MILESTONES, {
        role: 'STUDENT',
        applicationStatus: 'REJECTED',
      }),
    );

    expect(
      occurrences(section, '신청 승인 후 제출 상태를 확인할 수 있습니다.'),
    ).toBe(1);
    expect(linksOf(section)).toEqual([]);
    expect(section.textContent).not.toContain('미제출');
    expect(section.textContent).not.toContain('반려');
  });

  it('승인이 되돌려져도 이미 판정이 끝난 단계는 그 결과를 보여준다', () => {
    const steps = stepsOf(
      renderSection(
        programWith(
          [
            { ...MILESTONES[0], viewerSubmissionStatus: 'APPROVED' },
            MILESTONES[2],
          ],
          { role: 'STUDENT', applicationStatus: 'SUBMITTED' },
        ),
      ),
    );

    expect(steps[0].textContent).toContain('승인');
    expect(linksOf(steps[1])).toEqual([]);
  });

  it('가입하지 않은 방문자에게는 제출 상태 대신 가입 안내를 한 번만 적고 공지는 그대로 보인다', () => {
    const section = renderSection(
      programWith(MILESTONES, { role: null, applicationStatus: null }),
    );

    expect(
      occurrences(section, '가입 후 제출 상태를 확인할 수 있습니다.'),
    ).toBe(1);
    expect(section.textContent).not.toContain('로그인');
    expect(linksOf(section)).toEqual([]);
    expect(rowsOf(section)[2].textContent).toBe(
      '3중간 발표 자료11.27 18:00 · D-10',
    );
    const detail = detailOf(stepsOf(section)[2]);
    expect(detail?.getAttribute('data-state')).toBe('open');
    expect(detail?.textContent).toBe('PDF로 제출합니다.');
  });

  it('제출을 받는 단계가 하나도 없으면 가입 안내를 적지 않는다', () => {
    const section = renderSection(
      programWith([MILESTONES[4]], { role: null, applicationStatus: null }),
    );

    expect(section.textContent).not.toContain('가입 후');
  });

  it('승인됐는데 제출 상태만 비어 온 단계는 확인할 수 없다고 적는다', () => {
    const [step] = stepsOf(
      renderSection(programWith([MILESTONES[3]], APPROVED_STUDENT)),
    );

    expect(step.textContent).toContain('제출 상태를 확인할 수 없습니다.');
    expect(linksOf(step)).toEqual([]);
  });

  it('오늘 마감이 이미 지난 단계 대신 다음 단계를 지금 단계로 삼는다', () => {
    const section = renderSection(
      programWith(
        [
          milestoneOf('am', '오늘 09시 마감', '2026-11-17T09:00:00+09:00', 0),
          milestoneOf('next', '다음 단계', '2026-11-20T18:00:00+09:00', 3),
        ],
        STAFF,
      ),
    );

    expect(
      stepsOf(section).map((step) => step.getAttribute('aria-current')),
    ).toEqual([null, 'step']);
    expect(deadlinesOf(section)).toEqual([
      '11.17 09:00 · 마감',
      '11.20 18:00 · D-3',
    ]);
  });

  it('마감이 모두 지났으면 지금 단계를 두지 않고 모두 접어 둔다', () => {
    const steps = stepsOf(
      renderSection(programWith(STAFF_MILESTONES.slice(0, 2), STAFF)),
    );

    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([
      null,
      null,
    ]);
    expect(
      steps.map((step) => detailOf(step)?.getAttribute('data-state') ?? null),
    ).toEqual(['closed', 'closed']);
  });

  it('마일스톤이 없으면 타임라인 없이 빈 상태를 그린다', () => {
    const section = renderSection(programWith([], STAFF));

    expect(stepsOf(section)).toEqual([]);
    expect(section.textContent).toContain('아직 등록된 마일스톤이 없습니다');
  });
});
