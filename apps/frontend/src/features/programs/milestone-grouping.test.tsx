// @vitest-environment happy-dom

/**
 * 마일스톤 목록의 **경계**를 고정한다.
 *
 * 작성자 인터뷰에서 나온 지적은 「마일스톤이 여러 개일 때 구분이 안 된다」였고,
 * 원인은 신호가 뒤집혀 있던 것이다 — 화면에 그어진 유일한 가로선이 한 마일스톤과
 * 그 마일스톤의 제출 항목 사이에 있었고, 마일스톤 **사이**에는 12px 대 16px 이라는
 * 알아볼 수 없는 간격 차이뿐이었다.
 *
 * 여기 있는 검사는 「예쁘다」가 아니라 **어디까지가 한 마일스톤인가**를 본다.
 * DOM 상의 묶음(포함 관계)과 경계 표시가 함께 서 있어야 화면에서도, 화면 읽기
 * 도구에서도 같은 경계가 읽힌다.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MilestoneDocumentSectionBody } from './milestone-document-list';
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
    submissionItemCount: 1,
    viewerSubmissionStatus: 'NOT_SUBMITTED',
    applicationSubmissionSummary: null,
    ...overrides,
  };
}

const MILESTONES = [
  milestoneOf('milestone-1', '기획서 제출'),
  milestoneOf('milestone-2', '중간 보고'),
  milestoneOf('milestone-3', '최종 결과 요약'),
] as const;

function programWith(
  milestones: readonly ProgramMilestone[],
  role: ProgramDetail['viewer']['role'] = 'STUDENT',
): ProgramDetail {
  return {
    id: 'program-1',
    name: 'OSS 경진대회',
    organizer: '운영기관',
    category: 'OSS_CONTEST',
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

describe('마일스톤 목록의 경계', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    /*
      마일스톤마다 자기 서류를 하나씩 돌려준다. 어느 마일스톤의 제출 항목인지
      이름으로 구별할 수 있어야 「이 항목이 저 마일스톤 안에 있는가」를 물을 수 있다.
    */
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
    await vi.waitFor(() => {
      expect(
        container.querySelectorAll('[data-testid="milestone-document-rows"]'),
      ).toHaveLength(program.milestones.length);
    });
    const groups = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="milestone-group"]',
      ),
    ];
    /*
      묶음 개수를 **돌려주기 전에** 확인한다. 아래 검사들은 대부분 묶음을 순회하는
      모양이라, 묶음이 하나도 없으면 루프가 그냥 지나가며 조용히 통과한다 —
      묶음을 없앤 변경이 초록불로 넘어가는 자리다.
    */
    expect(groups).toHaveLength(program.milestones.length);
    return groups;
  }

  it('마일스톤마다 머리줄과 그 마일스톤의 제출 항목을 한 묶음 안에 담는다', async () => {
    const groups = await renderMilestones();

    for (const [index, group] of groups.entries()) {
      const milestone = MILESTONES[index];
      expect(
        group.querySelectorAll('[data-testid="milestone-row"]'),
      ).toHaveLength(1);
      /*
        제출 항목 목록이 **그 묶음 안에** 정확히 하나 있어야 한다. 예전 구조에서는
        머리줄과 제출 항목이 나란한 형제였고, 그래서 다음 마일스톤이 앞 마일스톤의
        제출 항목 바로 뒤에 아무 표시 없이 이어졌다.
      */
      const rows = group.querySelectorAll<HTMLElement>(
        '[data-testid="milestone-document-rows"]',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain(`${milestone.id} 서류`);
      expect(group.textContent).toContain(milestone.name);
    }
  });

  it('한 마일스톤의 제출 항목이 다른 마일스톤 묶음에 새지 않는다', async () => {
    const groups = await renderMilestones();

    for (const [index, group] of groups.entries()) {
      for (const other of MILESTONES.filter((_, i) => i !== index)) {
        expect(group.textContent).not.toContain(`${other.id} 서류`);
      }
    }
  });

  it('첫 묶음을 뺀 모든 묶음이 위쪽 경계선을 갖는다', async () => {
    const groups = await renderMilestones();

    /*
      `[&+&]:border-t-2` 는 **앞선 형제 묶음이 있을 때만** 선을 긋는다. 목록 첫
      줄에 선이 생기면 바깥 판(`ListPanel`)의 테두리와 겹쳐 두 겹으로 보인다.
    */
    for (const group of groups) {
      expect(group.className).toContain('[&+&]:border-t-2');
      expect(group.className).toContain('[&+&]:border-border');
    }
    expect(groups[0].previousElementSibling).toBeNull();
    for (const group of groups.slice(1)) {
      expect(group.previousElementSibling).toBe(
        groups[groups.indexOf(group) - 1],
      );
    }
  });

  it('묶음이 자기 마일스톤 이름을 이름표로 갖는다', async () => {
    const groups = await renderMilestones();

    for (const [index, group] of groups.entries()) {
      const labelId = group.getAttribute('aria-labelledby');
      expect(labelId).not.toBeNull();
      const label = group.querySelector(`#${CSS.escape(labelId ?? '')}`);
      expect(label?.textContent).toBe(MILESTONES[index].name);
    }
  });

  it('머리줄이 몇 번째 마일스톤인지 번호로 말한다', async () => {
    const groups = await renderMilestones();

    for (const [index, group] of groups.entries()) {
      const row = group.querySelector('[data-testid="milestone-row"]');
      expect(row?.textContent).toContain(String(index + 1));
    }
  });

  it('마일스톤이 하나뿐이면 경계선을 그리지 않는다', async () => {
    const groups = await renderMilestones(programWith([MILESTONES[0]]));

    expect(groups).toHaveLength(1);
    expect(groups[0].previousElementSibling).toBeNull();
  });
});

describe('제출 항목 블록이 그리지 않는 것', () => {
  const documents = [documentOf('milestone-1')];

  function bodyMarkup(state: 'ready' | 'failed'): string {
    return renderToStaticMarkup(
      <MilestoneDocumentSectionBody
        state={
          state === 'ready' ? { kind: 'ready', documents } : { kind: 'failed' }
        }
        viewerRole="STUDENT"
        closed={false}
        conflictNotice={null}
        onRetry={() => {}}
        onDocumentChange={() => {}}
        onSubmitConflict={() => {}}
      />,
    );
  }

  /**
   * 블록을 감싸는 **바깥 요소**의 클래스만 본다. 마크업 전체를 문자열로 훑으면
   * 안쪽 버튼의 `border-transparent` 가 `border-t` 로 걸려 늘 통과한다.
   */
  function blockClassName(state: 'ready' | 'failed'): string {
    const host = document.createElement('div');
    host.innerHTML = bodyMarkup(state);
    const block = host.firstElementChild;
    if (!(block instanceof HTMLElement)) {
      throw new TypeError('제출 항목 블록을 찾지 못했습니다.');
    }
    return block.className;
  }

  /*
    이 블록의 `border-t` 가 되살아나면 마일스톤 **안**을 가르는 선이 마일스톤
    **사이**를 가르는 선과 같은 무게로 돌아온다 — 작성자가 지적한 그 상태다.
    이 목록에서 가로선 하나는 「새 마일스톤」 하나를 뜻해야 한다.
  */
  it.each(['ready', 'failed'] as const)(
    '%s 상태에서 마일스톤 안을 가르는 가로선을 긋지 않는다',
    (state) => {
      expect(blockClassName(state).split(/\s+/)).not.toContain('border-t');
    },
  );

  it.each(['ready', 'failed'] as const)(
    '%s 상태에서 머리줄과 같은 좌우 여백 안에 선다',
    (state) => {
      // 예전에는 이 블록만 목록 왼쪽 끝에 붙어, 자식이 부모보다 바깥에 서 있었다.
      expect(blockClassName(state).split(/\s+/)).toContain('px-6');
    },
  );

  it('제출 항목은 그대로 다 보여 준다', () => {
    const html = bodyMarkup('ready');

    expect(html).toContain('제출 항목');
    expect(html).toContain('milestone-1 서류');
    expect(html).toContain('제출 0/1 완료');
  });
});
