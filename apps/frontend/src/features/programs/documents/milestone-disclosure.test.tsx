import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../../test-support/render-with-query';
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
import { requirementUploadPolicy } from '../../../../test-support/requirement-upload-policy';
import type { Requirement } from './requirement-dto';
import { ProgramMilestones } from '../catalog/program-detail-view';
import type { ProgramDetail, ProgramMilestone } from '../catalog/dto';

const NOW = new Date('2026-08-05T14:00:00+09:00');

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function milestoneOf(
  id: string,
  name: string,
  overrides: Partial<ProgramMilestone> = {},
): ProgramMilestone {
  return {
    id,
    name,

    dueAt: '2026-08-10T23:59:59+09:00',
    dDay: 5,
    description: `${name} 안내`,

    submissionItemCount: 1,
    viewerSubmissionStatus: 'NOT_SUBMITTED',
    applicationSubmissionSummary: null,
    ...overrides,
  };
}

function programWith(
  milestones: readonly ProgramMilestone[],
  role: ProgramDetail['viewer']['role'] = 'STUDENT',
): ProgramDetail {
  return {
    id: 'program-1',
    name: 'OSS 경진대회',
    organizers: ['운영기관'],
    trackType: 'CURRICULAR',
    applicationTemplateKey: 'basic',
    description: '프로그램 설명',
    repositoryProvisioningEnabled: true,
    applicationPeriod: {
      startsAt: '2026-07-01T00:00:00+09:00',
      endsAt: '2026-08-31T23:59:59+09:00',
    },
    viewer: { role, applicationStatus: 'APPROVED' },
    milestones: [...milestones],
  };
}

function documentOf(milestoneId: string): Requirement {
  return {
    id: `${milestoneId}-document`,
    milestoneId,
    name: `${milestoneId} 서류`,
    required: true,
    sortOrder: 0,
    submissionType: 'FILE_OR_TEXT' as const,
    hasTemplateFile: false,
    templateFileName: null,
  };
}

const MILESTONES = [
  milestoneOf('milestone-1', '기획서 제출', {
    dueAt: '2026-07-20T23:59:59+09:00',
    dDay: -16,
    viewerSubmissionStatus: 'APPROVED',
  }),
  milestoneOf('milestone-2', '중간 보고', {
    dueAt: '2026-07-31T23:59:59+09:00',
    dDay: -5,
  }),
  milestoneOf('milestone-3', '최종 결과 요약', {
    dueAt: '2026-08-15T23:59:59+09:00',
    dDay: 10,
    viewerSubmissionStatus: 'CHANGES_REQUESTED',
  }),
] as const;

describe('마일스톤 접기', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(
          typeof input === 'string' || input instanceof URL ? input : input.url,
        );
        const milestoneId = MILESTONES.map(({ id }) => id).find((id) =>
          url.includes(id),
        );
        return new Response(
          JSON.stringify({
            documents: milestoneId ? [documentOf(milestoneId)] : [],
            fileUpload: requirementUploadPolicy(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function renderMilestones(
    program: ProgramDetail = programWith(MILESTONES),
  ): Promise<readonly HTMLElement[]> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProgramMilestones program={program} />
        </QueryClientProvider>,
      );
    });
    const groups = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="milestone-group"]',
      ),
    ];
    expect(groups).toHaveLength(program.milestones.length);
    return groups;
  }

  function triggerOf(group: HTMLElement): HTMLButtonElement | null {
    const trigger = group.querySelector('[data-slot="collapsible-trigger"]');
    return trigger instanceof HTMLButtonElement ? trigger : null;
  }

  function panelOf(trigger: HTMLButtonElement): HTMLElement {
    const id = trigger.getAttribute('aria-controls');
    const panel = id === null ? null : document.getElementById(id);
    if (!(panel instanceof HTMLElement)) {
      throw new TypeError(
        '트리거가 가리키는 제출 항목 영역을 찾지 못했습니다.',
      );
    }
    return panel;
  }

  function stubDocuments(documents: readonly Requirement[]): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              documents,
              fileUpload: requirementUploadPolicy(),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
  }

  function rowButtons(group: HTMLElement): readonly HTMLButtonElement[] {
    return [
      ...group.querySelectorAll<HTMLButtonElement>(
        '[data-testid="milestone-row"] button:not([data-slot="collapsible-trigger"])',
      ),
    ];
  }

  function buttonLabels(scope: HTMLElement): readonly string[] {
    return [...scope.querySelectorAll('button')].map(
      (button) => button.textContent?.trim() ?? '',
    );
  }

  const rowButtonLabels = (group: HTMLElement) =>
    rowButtons(group).map((button) => button.textContent?.trim() ?? '');

  const openStates = (groups: readonly HTMLElement[]) =>
    groups.map((group) => triggerOf(group)?.getAttribute('aria-expanded'));

  it('처음에는 지금 차례인 마일스톤 하나만 펼친다', async () => {
    const groups = await renderMilestones();

    expect(openStates(groups)).toEqual(['false', 'false', 'true']);
  });

  it('마감이 모두 지났으면 모두 접어 둔다', async () => {
    const groups = await renderMilestones(
      programWith(
        MILESTONES.map((milestone) => ({
          ...milestone,
          dueAt: '2026-08-04T23:59:59+09:00',
          dDay: -1,
        })),
      ),
    );

    expect(openStates(groups)).toEqual(['false', 'false', 'false']);
  });

  it('오늘 마감이 이미 지났으면 그 마일스톤 대신 다음 것을 펼친다', async () => {
    const groups = await renderMilestones(
      programWith([
        milestoneOf('milestone-1', '오늘 09시 마감', {
          dueAt: '2026-08-05T09:00:00+09:00',
          dDay: 0,
        }),
        milestoneOf('milestone-2', '다음 단계', {
          dueAt: '2026-08-10T23:59:59+09:00',
          dDay: 5,
        }),
      ]),
    );

    expect(openStates(groups)).toEqual(['false', 'true']);
  });

  it('오늘 마감이 아직 남았으면 그 마일스톤을 펼친다', async () => {
    const groups = await renderMilestones(
      programWith([
        milestoneOf('milestone-1', '오늘 자정 마감', {
          dueAt: '2026-08-05T23:59:59+09:00',
          dDay: 0,
        }),
        milestoneOf('milestone-2', '다음 단계', {
          dueAt: '2026-08-10T23:59:59+09:00',
          dDay: 5,
        }),
      ]),
    );

    expect(openStates(groups)).toEqual(['true', 'false']);
  });

  it('오늘 마감이 전부 지났으면 모두 접어 둔다', async () => {
    const groups = await renderMilestones(
      programWith([
        milestoneOf('milestone-1', '오전 마감', {
          dueAt: '2026-08-05T09:00:00+09:00',
          dDay: 0,
        }),
        milestoneOf('milestone-2', '점심 마감', {
          dueAt: '2026-08-05T13:00:00+09:00',
          dDay: 0,
        }),
      ]),
    );

    expect(openStates(groups)).toEqual(['false', 'false']);
  });

  it('접힌 줄에는 번호·이름·마감·상태 배지만 남는다', async () => {
    const groups = await renderMilestones();

    expect(
      groups[0].querySelector('[data-testid="milestone-row"]')?.textContent,
    ).toBe('1기획서 제출07.20 23:59 · 마감승인');
  });

  it('보완을 요청받은 마일스톤 줄은 학생 말로 보완 필요라고 읽는다', async () => {
    const groups = await renderMilestones();

    const row = groups[2]?.querySelector('[data-testid="milestone-row"]');
    expect(row?.textContent).toContain('보완 필요');
    expect(row?.textContent).not.toContain('보완 요청');
  });

  it('접힌 마일스톤도 경계선과 묶음을 그대로 갖는다', async () => {
    const groups = await renderMilestones();

    for (const [position, group] of groups.entries()) {
      expect(group.tagName).toBe('ARTICLE');
      expect(
        group.querySelector('[data-slot="milestone-divider"]') !== null,
      ).toBe(position > 0);
    }
    for (const [index, group] of groups.slice(1).entries()) {
      expect(group.previousElementSibling).toBe(groups[index]);
    }
  });

  it('접힌 마일스톤의 공지와 제출 항목은 화면에서 빠진다', async () => {
    const groups = await renderMilestones();

    const closed = panelOf(triggerOf(groups[0]) as HTMLButtonElement);
    expect(closed.getAttribute('data-state')).toBe('closed');
    expect(closed.querySelector('[role="note"]')?.textContent).toBe(
      '기획서 제출 안내',
    );

    expect(closed.className).toContain('data-[state=closed]:hidden');

    const open = panelOf(triggerOf(groups[2]) as HTMLButtonElement);
    expect(open.getAttribute('data-state')).toBe('open');
  });

  it('트리거를 누르면 열리고 다시 누르면 닫힌다', async () => {
    const groups = await renderMilestones();
    const trigger = triggerOf(groups[0]) as HTMLButtonElement;

    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panelOf(trigger).getAttribute('data-state')).toBe('open');

    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panelOf(trigger).getAttribute('data-state')).toBe('closed');
  });

  it('제출 항목이 하나뿐인 마일스톤은 그 항목의 올리기를 줄에 두고 펼친 항목에는 되풀이하지 않는다', async () => {
    const groups = await renderMilestones();
    const panel = panelOf(triggerOf(groups[2]) as HTMLButtonElement);

    expect(rowButtonLabels(groups[2])).toEqual(['올리기']);
    expect(buttonLabels(panel)).not.toContain('올리기');
    expect(
      panel.querySelector('[data-testid="milestone-document-status"]'),
    ).not.toBeNull();
    expect(
      groups[2].querySelector('[data-testid="milestone-row"] a'),
    ).toBeNull();
  });

  it('이미 낸 하나뿐인 항목은 줄에 교체를 두고 펼친 항목에는 되풀이하지 않는다', async () => {
    stubDocuments([
      {
        ...documentOf('milestone-3'),
        viewerSubmission: {
          submitted: true,
          submittedAt: '2026-08-04T10:00:00+09:00',
          revision: 1,
          status: 'SUBMITTED',
          hasCurrentFile: false,
          currentFileName: null,
          review: null,
          history: { hasHistory: false, isComplete: true },
        },
      },
    ]);
    const groups = await renderMilestones(
      programWith([{ ...MILESTONES[2], viewerSubmissionStatus: 'SUBMITTED' }]),
    );
    const panel = panelOf(triggerOf(groups[0]) as HTMLButtonElement);

    expect(rowButtonLabels(groups[0])).toEqual(['교체']);
    expect(buttonLabels(panel)).not.toContain('교체');
  });

  it('낼 수 없는 하나뿐인 항목은 줄에 버튼을 올리지 않는다', async () => {
    const groups = await renderMilestones();

    expect(rowButtonLabels(groups[0])).toEqual([]);
    expect(rowButtonLabels(groups[1])).toEqual([]);
  });

  it('접힌 마일스톤의 줄에서 올리기를 누르면 그 마일스톤을 펼치고 제출 입력을 연다', async () => {
    const groups = await renderMilestones(
      programWith([
        milestoneOf('milestone-2', '지금 단계'),
        milestoneOf('milestone-3', '다음 단계', {
          dueAt: '2026-08-15T23:59:59+09:00',
          dDay: 10,
        }),
      ]),
    );
    const trigger = triggerOf(groups[1]) as HTMLButtonElement;
    const upload = rowButtons(groups[1]).at(0);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(upload?.textContent?.trim()).toBe('올리기');

    await act(async () => upload?.click());

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(
      panelOf(trigger).querySelector('input[type="file"], textarea'),
    ).not.toBeNull();
  });

  it('제출 항목이 여럿이면 줄에는 버튼을 두지 않고 펼친 항목마다 올리기를 둔다', async () => {
    stubDocuments([
      documentOf('milestone-3'),
      {
        ...documentOf('milestone-3'),
        id: 'milestone-3-document-2',
        name: 'milestone-3 서류 2',
      },
    ]);
    const groups = await renderMilestones(
      programWith([{ ...MILESTONES[2], submissionItemCount: 2 }]),
    );
    const panel = panelOf(triggerOf(groups[0]) as HTMLButtonElement);

    expect(rowButtonLabels(groups[0])).toEqual([]);
    expect(
      buttonLabels(panel).filter((label) => label === '올리기'),
    ).toHaveLength(2);
  });

  it('여러 마일스톤을 동시에 펼쳐 둘 수 있다', async () => {
    const groups = await renderMilestones();
    const first = triggerOf(groups[0]) as HTMLButtonElement;

    await act(async () => first.click());

    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(triggerOf(groups[2])?.getAttribute('aria-expanded')).toBe('true');
  });

  it('키보드로 열 수 있는 버튼이고 열림 상태를 이름에 실어 알린다', async () => {
    const groups = await renderMilestones();

    for (const group of groups) {
      const trigger = triggerOf(group);
      expect(trigger).not.toBeNull();

      expect(trigger?.tagName).toBe('BUTTON');
      expect(trigger?.type).toBe('button');
      expect(trigger?.disabled).toBe(false);
      expect(trigger?.tabIndex).toBe(0);
      expect(trigger?.getAttribute('aria-controls')).not.toBeNull();

      expect(
        trigger?.querySelectorAll('a,button,input,select,textarea'),
      ).toHaveLength(0);
    }
  });

  it('여닫는 영역이 자기 마일스톤의 제출 항목만 담는다', async () => {
    const groups = await renderMilestones();

    for (const [index, group] of groups.entries()) {
      const panel = panelOf(triggerOf(group) as HTMLButtonElement);
      expect(panel.textContent).toContain(`${MILESTONES[index].id} 서류`);
      for (const other of MILESTONES.filter((_, i) => i !== index)) {
        expect(panel.textContent).not.toContain(`${other.id} 서류`);
      }
    }
  });

  it('열어서 볼 것이 없는 마일스톤은 접지 않는다', async () => {
    const groups = await renderMilestones(
      programWith([
        milestoneOf('milestone-1', '안내용 단계', {
          submissionItemCount: 0,
          description: null,
        }),
      ]),
    );

    expect(triggerOf(groups[0])).toBeNull();
    expect(groups[0].getAttribute('data-state')).toBeNull();
  });

  it('제출 항목 없이 공지만 있는 마일스톤은 공지를 여닫는다', async () => {
    const groups = await renderMilestones(
      programWith([
        milestoneOf('milestone-1', '안내용 단계', { submissionItemCount: 0 }),
      ]),
    );

    const panel = panelOf(triggerOf(groups[0]) as HTMLButtonElement);
    expect(panel.querySelector('[role="note"]')?.textContent).toBe(
      '안내용 단계 안내',
    );
    expect(
      panel.querySelector('[data-testid="milestone-document-rows"]'),
    ).toBeNull();
  });

  it('제출 항목을 볼 수 없는 방문자에게는 공지만 여닫게 한다', async () => {
    const groups = await renderMilestones(programWith([MILESTONES[0]], null));

    const panel = panelOf(triggerOf(groups[0]) as HTMLButtonElement);
    expect(panel.querySelector('[role="note"]')?.textContent).toBe(
      '기획서 제출 안내',
    );
    expect(
      panel.querySelector('[data-testid="milestone-document-rows"]'),
    ).toBeNull();
  });

  it('공지도 제출 항목도 볼 수 없는 방문자에게는 접기를 걸지 않는다', async () => {
    const groups = await renderMilestones(
      programWith([{ ...MILESTONES[0], description: null }], null),
    );

    expect(triggerOf(groups[0])).toBeNull();
  });
});
