// @vitest-environment happy-dom

/**
 * #1206 — 교직원이 승인을 되돌린 학생(`APPROVED` → `SUBMITTED`)의 서류 줄에서 「수정」이
 * 사라지는지를 **화면 전체 경로로** 고정한다.
 *
 * 줄 하나만 따로 렌더해서는 이 결함을 잡을 수 없다. 실제 결함은 판정 함수가 아니라
 * **값이 흘러가지 않는 것**이었다 — `program-detail-view.tsx`가 마일스톤 머리줄에만
 * `applicationStatus`를 주고 그 아래 서류 블록에는 주지 않아, 서류 줄은 신청이 되돌려진
 * 것을 알 방법이 없었다. 그래서 여기서는 `ProgramMilestones`부터 그린다.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import type { MilestoneDocumentViewerSubmission } from './milestone-document-api';
import { ProgramMilestones } from './program-detail-view';
import type {
  ApplicationStatus,
  ProgramDetail,
  ProgramMilestone,
} from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const MILESTONE_ID = 'milestone-plan';

/**
 * 서류 축 마일스톤 — 서류가 있고 레거시 제출 축은 없다(`submissionType: null`,
 * `submissionItemCount: 1`). 백엔드 `programs.service.ts`가 서류만 있는 마일스톤에 대해
 * 내려주는 모양이다.
 */
function milestoneOf(
  overrides: Partial<ProgramMilestone> = {},
): ProgramMilestone {
  return {
    id: MILESTONE_ID,
    name: '기획서 제출',
    dueAt: '2026-12-31T23:59:59+09:00',
    dDay: 30,
    deadlineLabel: 'D-30',
    description: '기획서를 제출합니다.',
    submissionType: null,
    submissionItemCount: 1,
    viewerSubmissionStatus: null,
    applicationSubmissionSummary: null,
    ...overrides,
  };
}

function programWith(
  applicationStatus: ApplicationStatus | null,
  milestone: ProgramMilestone = milestoneOf(),
): ProgramDetail {
  return {
    id: 'program-1',
    name: '합성 프로그램',
    organizer: '운영기관',
    trackType: 'CURRICULAR',
    applicationTemplateKey: 'basic',
    lifecycle: 'PUBLISHED',
    description: '프로그램 설명',
    repositoryProvisioningEnabled: false,
    applicationPeriod: {
      startsAt: '2026-07-01T00:00:00+09:00',
      endsAt: '2026-08-31T23:59:59+09:00',
    },
    viewer: { role: 'STUDENT', applicationStatus },
    milestones: [milestone],
  };
}

/** 되돌리기는 제출 행을 지우지 않는다 — 승인 시절에 낸 제출이 그대로 남아 있다. */
const SUBMITTED_VIEWER: MilestoneDocumentViewerSubmission = {
  submitted: true,
  submittedAt: '2026-08-01T05:22:00.000Z',
  revision: 1,
  status: 'SUBMITTED',
  hasCurrentFile: true,
  review: null,
  history: { hasHistory: false, isComplete: true },
};

describe('되돌려진 신청의 서류 줄', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              documents: [
                {
                  id: 'document-1',
                  milestoneId: MILESTONE_ID,
                  name: '기획서',
                  required: true,
                  sortOrder: 0,
                  hasTemplateFile: false,
                  templateFileName: null,
                  viewerSubmission: SUBMITTED_VIEWER,
                },
              ],
              fileUpload: milestoneDocumentUploadPolicy(),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderMilestones(program: ProgramDetail): Promise<void> {
    await act(async () => {
      root.render(<ProgramMilestones program={program} />);
    });
    /*
      서류 줄이 실제로 그려질 때까지 기다린 뒤에 본다. 기다리지 않으면 아직 아무것도
      없는 화면에서 「수정이 없다」가 참이 되어, 고치지 않은 코드도 통과한다.
    */
    await vi.waitFor(() => {
      expect(
        container.querySelectorAll('[data-testid="milestone-document-row"]'),
      ).toHaveLength(1);
    });
  }

  function buttonTexts(): readonly string[] {
    return Array.from(container.querySelectorAll('button')).map(
      (button) => button.textContent?.trim() ?? '',
    );
  }

  it('승인이 되돌려지면 「수정」을 내놓지 않는다', async () => {
    await renderMilestones(programWith('SUBMITTED'));

    expect(buttonTexts()).not.toContain('수정');
  });

  /**
   * 조작을 걷기만 하고 이유를 말하지 않으면 학생은 화면이 고장 났다고 읽는다. 이 화면은
   * 그 이유를 **바로 위 마일스톤 머리줄**에서 이미 말하고 있다 — 서류 줄마다 같은 문장을
   * 한 번 더 적지 않기로 한 근거가 이것이다. 그 문장이 사라지면 이 검사가 깨진다.
   */
  it('왜 지금은 못 내는지는 같은 묶음 안에 남아 있다', async () => {
    await renderMilestones(programWith('SUBMITTED'));

    const group = container.querySelector('[data-testid="milestone-group"]');
    expect(group?.textContent).toContain('신청 승인 후');
  });

  /**
   * 대조 — 정상 참여자의 재제출은 그대로다. 이 검사가 없으면 「수정」을 아무에게나 지우는
   * 변경도 위 검사를 통과한다.
   */
  it('승인된 학생의 「수정」은 그대로 남는다', async () => {
    await renderMilestones(programWith('APPROVED'));

    expect(buttonTexts()).toContain('수정');
  });
});
