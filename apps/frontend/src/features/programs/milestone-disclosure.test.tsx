// @vitest-environment happy-dom

/**
 * 마일스톤 목록의 **접기**를 고정한다.
 *
 * 앞선 작업이 마일스톤 사이에 선을 그어 경계를 세우자 작성자가 다시 말했다 —
 * 「경계는 알겠는데 세부 내용이 한눈에 들어오지 않는다. 처음엔 마일스톤만 보이고
 * 누르면 세부가 보이게 해 달라.」 원인은 한 마일스톤이 제출 항목·판정 사유·제출
 * 이력까지 달고 세로로 500px 넘게 자라, 목록이 아니라 문서가 되어 있었던 것이다.
 *
 * 여기 있는 검사는 「접힌다」가 아니라 **접힌 채로도 학생이 어디를 눌러야 하는지
 * 알 수 있는가**, 그리고 **처음 열린 하나가 지금 낼 차례인가**를 본다.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MilestoneDocument } from './milestone-document-api';
import { ProgramMilestones } from './program-detail-view';
import type { ProgramDetail, ProgramMilestone } from './types';

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
    // 접기는 「열어서 볼 것이 있는가」로 갈린다 — 기본값은 있는 쪽이다.
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

/** 접힌 마일스톤과 펼친 마일스톤이 섞이도록, 마감이 지난 둘 뒤에 남은 하나를 둔다. */
const MILESTONES = [
  milestoneOf('milestone-1', '기획서 제출', {
    dDay: -16,
    deadlineLabel: '마감 지남',
    viewerSubmissionStatus: 'APPROVED',
  }),
  milestoneOf('milestone-2', '중간 보고', {
    dDay: -5,
    deadlineLabel: '마감 지남',
  }),
  milestoneOf('milestone-3', '최종 결과 요약', {
    dDay: 10,
    deadlineLabel: 'D-10',
    viewerSubmissionStatus: 'CHANGES_REQUESTED',
  }),
] as const;

describe('마일스톤 접기', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
          JSON.stringify(milestoneId ? [documentOf(milestoneId)] : []),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderMilestones(
    program: ProgramDetail = programWith(MILESTONES),
  ): Promise<readonly HTMLElement[]> {
    await act(async () => {
      root.render(<ProgramMilestones program={program} />);
    });
    const groups = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="milestone-group"]',
      ),
    ];
    expect(groups).toHaveLength(program.milestones.length);
    return groups;
  }

  /** 그 묶음의 접기 트리거. 접히지 않는 마일스톤이면 `null`. */
  function triggerOf(group: HTMLElement): HTMLButtonElement | null {
    const trigger = group.querySelector('[data-slot="collapsible-trigger"]');
    return trigger instanceof HTMLButtonElement ? trigger : null;
  }

  /** 트리거가 `aria-controls` 로 가리키는 영역. 연결이 끊겨 있으면 던진다. */
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

  it('처음에는 지금 차례인 마일스톤 하나만 펼친다', async () => {
    const groups = await renderMilestones();

    /*
      전부 접으면 「지금 낼 것」을 보는 데 한 번을 더 눌러야 하고, 다 펼치면
      작성자가 지적한 상태 그대로다. 차례는 마감이 정한다 — 마감이 지나지 않은
      첫 마일스톤(D-10)이고, 그 앞의 둘은 접힌다.
    */
    const expanded = groups.map((group) =>
      triggerOf(group)?.getAttribute('aria-expanded'),
    );
    expect(expanded).toEqual(['false', 'false', 'true']);
  });

  it('마감이 모두 지났으면 마지막 마일스톤을 펼친다', async () => {
    // 지난 것뿐이라 「다음에 낼 것」이 없다. 그래도 하나는 열려 있어야 하고,
    // 그 하나는 가장 최근 단계다 — 첫 단계를 열면 학생을 목록의 맨 앞으로 되돌린다.
    const groups = await renderMilestones(
      programWith(
        MILESTONES.map((milestone) => ({
          ...milestone,
          dDay: -1,
          deadlineLabel: '마감 지남',
        })),
      ),
    );

    expect(
      groups.map((group) => triggerOf(group)?.getAttribute('aria-expanded')),
    ).toEqual(['false', 'false', 'true']);
  });

  it('접힌 줄에도 이름·마감·상태 배지가 남는다', async () => {
    const groups = await renderMilestones();

    /*
      접힌 줄이 이름만 남으면 학생은 **어느 줄을 눌러야 하는지** 모른다. 눌러야 할
      곳을 고르는 근거(마감이 언제인가, 내가 낸 것이 어떤 상태인가)는 접힌 채로도
      보여야 한다.
    */
    const [first] = groups;
    expect(first.textContent).toContain('기획서 제출');
    expect(first.textContent).toContain('마감 지남');
    expect(first.textContent).toContain('승인');
    // 순번도 남는다 — 앞 커밋이 경계 표시로 세운 것이다.
    expect(
      first.querySelector('[data-testid="milestone-row"]')?.textContent,
    ).toContain('1');
  });

  it('접힌 마일스톤도 경계선과 묶음을 그대로 갖는다', async () => {
    const groups = await renderMilestones();

    /*
      접기 뿌리가 `article` 을 감싸는 별도 `div` 로 들어가면 묶음들이 더는 형제가
      아니게 되어 `[&+&]` 가 한 줄도 긋지 못한다 — 앞 커밋이 세운 마일스톤 사이
      경계가 조용히 사라지는 자리다.
    */
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
    /*
      `data-[state=closed]:hidden` 은 `display:none` 이라 화면 읽기 도구와 탭
      순서에서도 함께 빠진다 — 접힌 내용이 눈에만 안 보이고 몰래 읽히면 안 된다.
      (프로그램 안내 카드가 쓰는 것과 같은 조합이다.)
    */
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

  it('여러 마일스톤을 동시에 펼쳐 둘 수 있다', async () => {
    const groups = await renderMilestones();
    const first = triggerOf(groups[0]) as HTMLButtonElement;

    await act(async () => first.click());

    /*
      하나만 열리는 아코디언이면, 앞 단계를 확인하려고 누른 순간 지금 낼 것이
      제 발로 닫힌다 — 사용자가 요청하지 않은 닫힘이다. 접기는 마일스톤마다
      따로 서고, 열어 둔 것은 그대로 열려 있는다.
    */
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(triggerOf(groups[2])?.getAttribute('aria-expanded')).toBe('true');
  });

  it('키보드로 열 수 있는 버튼이고 열림 상태를 이름에 실어 알린다', async () => {
    const groups = await renderMilestones();

    for (const group of groups) {
      const trigger = triggerOf(group);
      expect(trigger).not.toBeNull();
      // 네이티브 `button` 이라야 Enter·Space 가 별도 코드 없이 동작하고, 탭
      // 순서에도 저절로 들어간다. `div role="button"` 로 바꾸면 둘 다 잃는다.
      expect(trigger?.tagName).toBe('BUTTON');
      expect(trigger?.type).toBe('button');
      expect(trigger?.disabled).toBe(false);
      expect(trigger?.tabIndex).toBe(0);
      expect(trigger?.getAttribute('aria-controls')).not.toBeNull();
      // 트리거 안에 또 다른 조작 요소가 들어가면 그 컨트롤은 키보드로 닿지 못한다.
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
    /*
      제출 항목이 0개면 펼쳐도 나올 것이 없다. 눌러도 아무 일이 없는 화살표는
      「고장」으로 읽힌다. 대신 예전처럼 그대로 둔다 — 이 판정이 틀리더라도
      최악이 「접히지 않는 마일스톤」이지 「사라진 제출 항목」이 아니어야 한다.
    */
    const groups = await renderMilestones(
      programWith([
        milestoneOf('milestone-1', '안내용 단계', { submissionItemCount: 0 }),
      ]),
    );

    expect(triggerOf(groups[0])).toBeNull();
    expect(groups[0].getAttribute('data-state')).toBeNull();
  });

  it('제출 항목을 볼 수 없는 방문자에게는 접기를 걸지 않는다', async () => {
    // 비로그인에게는 제출 항목 블록 자체가 그려지지 않는다(`MilestoneDocumentSection`).
    // 여닫을 것이 없는데 화살표만 서면 눌러 본 사람이 화면이 고장 났다고 읽는다.
    const groups = await renderMilestones(programWith([MILESTONES[0]], null));

    expect(triggerOf(groups[0])).toBeNull();
  });
});
