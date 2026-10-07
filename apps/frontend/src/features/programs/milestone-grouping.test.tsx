import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import { MilestoneDocumentSectionBody } from './milestone-document-list';
import type { MilestoneDocument } from './milestone-document-api';
import { milestoneSubmissionAccess } from './milestone-submission-access';
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

describe('마일스톤 목록의 경계', () => {
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
          JSON.stringify({
            documents: milestoneId ? [documentOf(milestoneId)] : [],
            fileUpload: milestoneDocumentUploadPolicy(),
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
          state === 'ready'
            ? {
                kind: 'ready',
                documents,
                fileUpload: milestoneDocumentUploadPolicy(),
              }
            : { kind: 'failed' }
        }
        viewerRole="STUDENT"
        closed={false}
        submissionAccess={milestoneSubmissionAccess({
          role: 'STUDENT',
          applicationStatus: 'APPROVED',
        })}
        conflictNotice={null}
        onRetry={() => {}}
        onDocumentChange={() => {}}
        onSubmitConflict={() => {}}
      />,
    );
  }

  function blockClassName(state: 'ready' | 'failed'): string {
    const host = document.createElement('div');
    host.innerHTML = bodyMarkup(state);
    const block = host.firstElementChild;
    if (!(block instanceof HTMLElement)) {
      throw new TypeError('제출 항목 블록을 찾지 못했습니다.');
    }
    return block.className;
  }

  it.each(['ready', 'failed'] as const)(
    '%s 상태에서 마일스톤 안을 가르는 가로선을 긋지 않는다',
    (state) => {
      expect(blockClassName(state).split(/\s+/)).not.toContain('border-t');
    },
  );

  it.each(['ready', 'failed'] as const)(
    '%s 상태에서 머리줄과 같은 좌우 여백 안에 선다',
    (state) => {
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
