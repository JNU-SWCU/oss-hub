import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import type { MilestoneDocument } from './milestone-document-api';
import { ProgramMilestones } from './program-detail-view';
import type { ProgramDetail, ProgramMilestone } from './types';

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
    deadlineLabel: 'D-5',
    description: `${name} 안내`,
    submissionType: 'FILE',

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
    organizer: '운영기관',
    trackType: 'CURRICULAR',
    applicationTemplateKey: 'basic',
    lifecycle: 'PUBLISHED',
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

function documentOf(milestoneId: string): MilestoneDocument {
  return {
    id: `${milestoneId}-document`,
    milestoneId,
    name: `${milestoneId} 서류`,
    required: true,
    sortOrder: 0,
    hasTemplateFile: false,
    templateFileName: null,
  };
}

const MILESTONES = [
  milestoneOf('milestone-1', '기획서 제출', {
    dueAt: '2026-07-20T23:59:59+09:00',
    dDay: -16,
    deadlineLabel: '마감 지남',
    viewerSubmissionStatus: 'APPROVED',
  }),
  milestoneOf('milestone-2', '중간 보고', {
    dueAt: '2026-07-31T23:59:59+09:00',
    dDay: -5,
    deadlineLabel: '마감 지남',
  }),
  milestoneOf('milestone-3', '최종 결과 요약', {
    dueAt: '2026-08-15T23:59:59+09:00',
    dDay: 10,
    deadlineLabel: 'D-10',
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
      vi.fn((input: RequestInfo | URL) => {
        const url = String(
          typeof input === 'string' || input instanceof URL ? input : input.url,
        );
        const milestoneId = MILESTONES.map(({ id }) => id).find((id) =>
          url.includes(id),
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              documents: milestoneId ? [documentOf(milestoneId)] : [],
              fileUpload: milestoneDocumentUploadPolicy(),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }),
    );
  });

  afterEach(async () => {
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function renderMilestones(
    program: ProgramDetail = programWith(MILESTONES),
  ): Promise<readonly HTMLElement[]> {
    await act(() => {
      root.render(<ProgramMilestones program={program} />);
      return Promise.resolve();
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

  const openStates = (groups: readonly HTMLElement[]) =>
    groups.map((group) => triggerOf(group)?.getAttribute('aria-expanded'));

  it('처음에는 지금 차례인 마일스톤 하나만 펼친다', async () => {
    const groups = await renderMilestones();

    expect(openStates(groups)).toEqual(['false', 'false', 'true']);
  });

  it('마감이 모두 지났으면 마지막 마일스톤을 펼친다', async () => {
    const groups = await renderMilestones(
      programWith(
        MILESTONES.map((milestone) => ({
          ...milestone,
          dueAt: '2026-08-04T23:59:59+09:00',
          dDay: -1,
          deadlineLabel: '마감 지남',
        })),
      ),
    );

    expect(openStates(groups)).toEqual(['false', 'false', 'true']);
  });

  it('오늘 마감이 이미 지났으면 그 마일스톤 대신 다음 것을 펼친다', async () => {
    const groups = await renderMilestones(
      programWith([
        milestoneOf('milestone-1', '오늘 09시 마감', {
          dueAt: '2026-08-05T09:00:00+09:00',
          dDay: 0,
          deadlineLabel: '오늘 마감',
        }),
        milestoneOf('milestone-2', '다음 단계', {
          dueAt: '2026-08-10T23:59:59+09:00',
          dDay: 5,
          deadlineLabel: 'D-5',
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
          deadlineLabel: '오늘 마감',
        }),
        milestoneOf('milestone-2', '다음 단계', {
          dueAt: '2026-08-10T23:59:59+09:00',
          dDay: 5,
          deadlineLabel: 'D-5',
        }),
      ]),
    );

    expect(openStates(groups)).toEqual(['true', 'false']);
  });

  it('오늘 마감이 전부 지났으면 마지막 마일스톤을 펼친다', async () => {
    const groups = await renderMilestones(
      programWith([
        milestoneOf('milestone-1', '오전 마감', {
          dueAt: '2026-08-05T09:00:00+09:00',
          dDay: 0,
          deadlineLabel: '오늘 마감',
        }),
        milestoneOf('milestone-2', '점심 마감', {
          dueAt: '2026-08-05T13:00:00+09:00',
          dDay: 0,
          deadlineLabel: '오늘 마감',
        }),
      ]),
    );

    expect(openStates(groups)).toEqual(['false', 'true']);
  });

  it('접힌 줄에도 이름·마감·상태 배지가 남는다', async () => {
    const groups = await renderMilestones();

    const [first] = groups;
    expect(first.textContent).toContain('기획서 제출');
    expect(first.textContent).toContain('마감 지남');
    expect(first.textContent).toContain('승인');

    expect(
      first.querySelector('[data-testid="milestone-row"]')?.textContent,
    ).toContain('1');
  });

  it('접힌 마일스톤도 경계선과 묶음을 그대로 갖는다', async () => {
    const groups = await renderMilestones();

    for (const group of groups) {
      expect(group.tagName).toBe('ARTICLE');
      expect(group.className).toContain('[&+&]:border-t-2');
    }
    for (const [index, group] of groups.slice(1).entries()) {
      expect(group.previousElementSibling).toBe(groups[index]);
    }
  });

  it('접힌 마일스톤의 제출 항목은 화면에서 빠진다', async () => {
    const groups = await renderMilestones();

    const closed = panelOf(triggerOf(groups[0]) as HTMLButtonElement);
    expect(closed.getAttribute('data-state')).toBe('closed');

    expect(closed.className).toContain('data-[state=closed]:hidden');

    const open = panelOf(triggerOf(groups[2]) as HTMLButtonElement);
    expect(open.getAttribute('data-state')).toBe('open');
  });

  it('트리거를 누르면 열리고 다시 누르면 닫힌다', async () => {
    const groups = await renderMilestones();
    const trigger = triggerOf(groups[0]) as HTMLButtonElement;

    await act(() => Promise.resolve(trigger.click()));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panelOf(trigger).getAttribute('data-state')).toBe('open');

    await act(() => Promise.resolve(trigger.click()));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panelOf(trigger).getAttribute('data-state')).toBe('closed');
  });

  it('여러 마일스톤을 동시에 펼쳐 둘 수 있다', async () => {
    const groups = await renderMilestones();
    const first = triggerOf(groups[0]) as HTMLButtonElement;

    await act(() => Promise.resolve(first.click()));

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
        milestoneOf('milestone-1', '안내용 단계', { submissionItemCount: 0 }),
      ]),
    );

    expect(triggerOf(groups[0])).toBeNull();
    expect(groups[0].getAttribute('data-state')).toBeNull();
  });

  it('제출 항목을 볼 수 없는 방문자에게는 접기를 걸지 않는다', async () => {
    const groups = await renderMilestones(programWith([MILESTONES[0]], null));

    expect(triggerOf(groups[0])).toBeNull();
  });
});
