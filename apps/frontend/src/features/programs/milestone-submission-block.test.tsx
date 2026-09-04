// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { milestoneDocumentUploadPolicy } from '../../../test-support/milestone-document-upload-policy';
import { ProgramMilestones } from './program-detail-view';
import type {
  MilestoneDocument,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-api';
import type { ApplicationStatus, ProgramDetail } from './types';

/**
 * 마일스톤 블록의 **위아래를 함께** 본다.
 *
 * 이 파일이 따로 있는 이유(#1098): 위쪽 줄과 아래쪽 제출 항목을 각각 렌더해 보면 둘 다
 * 자기 말은 맞게 한다. 어긋남은 **한 화면에 같이 놓았을 때만** 보인다 — 위는 「승인 후
 * 제출할 수 있습니다」라고 적고, 아래는 눌리는 「올리기」를 세워 두었다. 그래서 여기서는
 * 조각이 아니라 `ProgramMilestones`를 통째로 그린다.
 */

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

/** 아직 아무것도 내지 않은 서류. */
const UNSUBMITTED: MilestoneDocumentViewerSubmission = {
  submitted: false,
  submittedAt: null,
  revision: null,
  status: null,
  hasCurrentFile: false,
  review: null,
  history: { hasHistory: false, isComplete: true },
};

/** 이미 판정이 끝난 서류 — 되돌린 승인 뒤에도 이 상태로 남아 있다. */
function decided(
  status: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
): MilestoneDocumentViewerSubmission {
  return {
    submitted: true,
    submittedAt: '2026-08-01T10:00:00+09:00',
    revision: 1,
    status,
    hasCurrentFile: true,
    review: null,
    history: { hasHistory: false, isComplete: true },
  };
}

function documentOf(
  viewerSubmission: MilestoneDocumentViewerSubmission,
): MilestoneDocument {
  return {
    id: 'document-1',
    milestoneId: 'milestone-1',
    name: '학습 회고',
    required: true,
    sortOrder: 0,
    hasTemplateFile: false,
    templateFileName: null,
    viewerSubmission,
  };
}

/** 마감 전 / 마감 뒤. 마감은 `ProgramMilestones`가 `dueAt`으로 스스로 판정한다. */
const OPEN_DUE = {
  dueAt: '2099-08-20T23:59:59+09:00',
  dDay: 19,
  deadlineLabel: 'D-19',
} as const;
const PAST_DUE = {
  dueAt: '2020-08-20T23:59:59+09:00',
  dDay: -12,
  deadlineLabel: '마감 지남',
} as const;

function program(
  applicationStatus: ApplicationStatus | null,
  due: typeof OPEN_DUE | typeof PAST_DUE = OPEN_DUE,
): ProgramDetail {
  return {
    id: 'program-1',
    name: '합성 기초 스터디',
    organizer: '운영기관',
    trackType: 'EXTRACURRICULAR',
    applicationTemplateKey: 'oss-contest',
    lifecycle: 'PUBLISHED',
    description: '프로그램 설명',
    repositoryProvisioningEnabled: false,
    applicationPeriod: {
      startsAt: '2026-07-01T00:00:00+09:00',
      endsAt: '2026-12-31T23:59:59+09:00',
    },
    viewer: { role: 'STUDENT', applicationStatus },
    milestones: [
      {
        id: 'milestone-1',
        name: '학습 회고 제출',
        ...due,
        description: null,
        // 서류 제출 항목만 있는 새 모델 — 옛 제출 축은 쓰지 않는다.
        submissionType: null,
        submissionItemCount: 1,
        viewerSubmissionStatus: null,
        applicationSubmissionSummary: null,
      },
    ],
  };
}

describe('신청 상태가 마일스톤 블록의 위아래를 함께 정한다', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(
    applicationStatus: ApplicationStatus | null,
    {
      viewerSubmission = UNSUBMITTED,
      due = OPEN_DUE,
    }: {
      readonly viewerSubmission?: MilestoneDocumentViewerSubmission;
      readonly due?: typeof OPEN_DUE | typeof PAST_DUE;
    } = {},
  ) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            documents: [documentOf(viewerSubmission)],
            fileUpload: milestoneDocumentUploadPolicy(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await act(async () => {
      root.render(
        <ProgramMilestones program={program(applicationStatus, due)} />,
      );
    });
    /*
     * 서류 줄이 실제로 그려질 때까지 기다린다 — 마일스톤 이름으로 기다리면 위쪽 줄이 이미
     * 그것을 갖고 있어서 목록 조회가 실패해도 초록으로 지나간다.
     */
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="milestone-document-row"]'),
      ).not.toBeNull();
    });
  }

  function actionButton(label: '올리기' | '수정'): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === label,
    );
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError(`「${label}」 버튼을 찾지 못했습니다.`);
    }
    return found;
  }

  function actionLabels(): readonly (string | undefined)[] {
    return [...container.querySelectorAll('button')].map((button) =>
      button.textContent?.trim(),
    );
  }

  function blockedNote(): Element | null {
    return container.querySelector(
      '[data-testid="milestone-document-blocked-note"]',
    );
  }

  function submissionInput(): Element | null {
    return container.querySelector(
      'textarea[placeholder="제출할 내용이나 설명을 적어 주세요."], input[type="file"]',
    );
  }

  /**
   * 변이 검증 대상 1 — 아래쪽 제출 항목이 신청 상태를 다시 못 받게 되면 여기가 깨진다.
   * 버튼이 눌리는 채로 남아 학생은 파일을 고르고 나서야 403(MSD_005)을 받는다.
   */
  it.each([
    [
      null,
      '이 프로그램에 신청해야 제출할 수 있습니다.',
      '신청 후 제출할 수 있습니다',
    ],
    [
      'SUBMITTED' as const,
      '신청 승인을 기다리는 중입니다. 승인되면 제출할 수 있습니다.',
      '승인 후 제출할 수 있습니다',
    ],
  ])(
    '%s 상태에서는 위쪽 안내와 아래쪽 버튼이 같은 말을 한다',
    async (applicationStatus, notice, buttonNote) => {
      await render(applicationStatus);

      // 위: 왜 못 내는지.
      expect(container.textContent).toContain(notice);
      // 아래: 버튼은 남아 있되 눌리지 않고, 그 옆에 같은 판정에서 나온 이유가 붙는다.
      const button = actionButton('올리기');
      expect(button.disabled).toBe(true);
      const note = blockedNote();
      expect(note?.textContent).toBe(buttonNote);
      expect(button.getAttribute('aria-describedby')).toBe(note?.id);

      // 눌러도 제출 입력이 열리지 않는다.
      await act(async () => button.click());
      expect(submissionInput()).toBeNull();
    },
  );

  /**
   * 「신청하기」는 **페이지 상단 헤더에 하나면 된다**(`ProgramActions`, 이 화면의 주
   * 버튼). 마일스톤은 프로그램마다 여럿이라 줄마다 같은 버튼을 세우면 한 화면에 같은
   * 목적지가 몇 번씩 반복된다 — 그래서 마일스톤 블록에는 두지 않는다.
   *
   * 변이 검증 대상 — 안내 문구 옆에 경로를 다시 붙이면 여기가 깨진다.
   */
  it('마일스톤 블록에는 신청 경로를 두지 않는다', async () => {
    await render(null);

    const applyLinks = [...container.querySelectorAll('a')].filter(
      (anchor) =>
        anchor.textContent?.includes('신청') === true ||
        anchor.getAttribute('href')?.endsWith('/apply') === true,
    );
    expect(applyLinks).toEqual([]);
  });

  /**
   * 반려는 이 티켓이 다루지 않는다 — **#1098 이전 화면 그대로**여야 한다.
   *
   * 앞선 구현은 반려도 신청 전·승인 대기와 함께 묶어 「올리기」를 흐리게 하고 반려 사유를
   * 언급하는 문구를 붙였는데, 반려 학생에게 무엇을 보여줄지는 따로 정해야 할 판단이다.
   * 답이 정해질 때까지 화면이 나빠지지 않아야 하므로, 옛 문구와 눌리는 버튼을 여기에
   * 고정한다 — 이 상태를 다시 `blocked`로 옮기면 여기가 깨진다.
   */
  it('반려는 #1098 이전 화면 그대로 둔다', async () => {
    await render('REJECTED');

    // 위: 옛 문구 그대로. 신청도 안 한 사람에게 하던 말이 아니라 원래 있던 말이다.
    expect(container.textContent).toContain('신청 승인 후 제출할 수 있습니다');
    expect(container.textContent).not.toContain('반려');

    // 아래: 버튼은 눌리고, 흐려진 버튼 옆 문구도 붙지 않는다.
    const button = actionButton('올리기');
    expect(button.disabled).toBe(false);
    expect(blockedNote()).toBeNull();

    // 제출 입력도 옛날처럼 열린다 — 저장 여부는 서버가 정한다(MSD_005).
    await act(async () => button.click());
    expect(submissionInput()).not.toBeNull();
  });

  /**
   * 변이 검증 대상 2 — 신청 게이트를 승인된 학생까지 넓히면 여기가 깨진다. 첫 제출과
   * 마감 전 교체가 함께 사라져 기능이 하나 없어진다.
   */
  it('승인된 학생의 첫 제출은 그대로 열려 있다', async () => {
    await render('APPROVED');

    const button = actionButton('올리기');
    expect(button.disabled).toBe(false);
    expect(blockedNote()).toBeNull();
    expect(container.textContent).toContain(
      '아래 제출 항목에서 내용이나 파일을 제출하세요',
    );

    await act(async () => button.click());
    expect(submissionInput()).not.toBeNull();
  });

  /**
   * 되돌린 승인(APPROVED → SUBMITTED). 되돌린 시점에 **이미 판정이 끝난 서류**가 남아
   * 있는데, 신청 상태를 먼저 보면 그 줄이 「승인 후 제출할 수 있습니다」라고 말한다 —
   * 학생이 그 말대로 기다려 다시 승인돼도 그 서류는 열리지 않고 서버는 계속 재제출을
   * 거절한다(MSD_023). 화면이 내미는 해결책은 실제로 도달 가능한 것이어야 한다.
   *
   * 변이 검증 대상 — 신청 게이트를 서류 판정 앞으로 되돌리면 여기가 깨진다.
   */
  it.each([
    ['APPROVED' as const, '승인된 제출 항목은 다시 제출할 수 없습니다.'],
    ['REJECTED' as const, '반려된 제출 항목은 다시 제출할 수 없습니다.'],
  ])(
    '되돌린 승인 뒤 이미 %s 된 서류는 신청 안내가 아니라 그 서류의 이유를 말한다',
    async (documentStatus, settledNote) => {
      await render('SUBMITTED', { viewerSubmission: decided(documentStatus) });

      expect(container.textContent).toContain(settledNote);
      // 도달할 수 없는 해결책을 내밀지 않는다.
      expect(container.textContent).not.toContain('승인 후 제출할 수 있습니다');
      expect(blockedNote()).toBeNull();
      // 다시 열릴 일이 없는 자리에는 버튼 모양도 남기지 않는다.
      expect(actionLabels()).not.toContain('수정');
    },
  );

  /**
   * 마감이 지난 첫 제출. 같은 우선순위 뒤집힘이 「승인되면 가능해진다」고 말하게 한다 —
   * 신청이 승인돼도 지나간 마감은 돌아오지 않는다.
   *
   * 변이 검증 대상 — 마감 게이트를 신청 안내 뒤로 되돌리면 여기가 깨진다. 이유를 떼고
   * 버튼만 말없이 흐리게 두어도(예전 화면) 깨진다.
   */
  it('마감이 지난 첫 제출은 승인이 아니라 마감을 이유로 든다', async () => {
    await render('SUBMITTED', { due: PAST_DUE });

    const button = actionButton('올리기');
    expect(button.disabled).toBe(true);
    const note = blockedNote();
    expect(note?.textContent).toBe('마감이 지나 제출할 수 없습니다');
    expect(button.getAttribute('aria-describedby')).toBe(note?.id);
    expect(container.textContent).not.toContain('승인 후 제출할 수 있습니다');

    await act(async () => button.click());
    expect(submissionInput()).toBeNull();
  });

  /**
   * 마감 뒤 보완 요청은 마감을 지나간다 — 교직원이 「고쳐서 다시 내세요」라고 한 것을
   * 화면이 막으면 그 요청 자체가 뜻을 잃는다. 그때는 신청이 유일하게 남은 벽이므로
   * 신청 상태가 이유가 된다: 순서를 바꾼 것이지 마감 예외를 없앤 것이 아니다.
   */
  it('마감 뒤 보완 요청은 마감이 아니라 신청 상태를 이유로 든다', async () => {
    await render('SUBMITTED', {
      due: PAST_DUE,
      viewerSubmission: decided('CHANGES_REQUESTED'),
    });

    expect(blockedNote()?.textContent).toBe('승인 후 제출할 수 있습니다');
    expect(container.textContent).not.toContain('마감이 지나');
  });
});
