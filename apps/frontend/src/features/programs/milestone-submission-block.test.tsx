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

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const UNSUBMITTED: MilestoneDocumentViewerSubmission = {
  submitted: false,
  submittedAt: null,
  revision: null,
  status: null,
  hasCurrentFile: false,
  currentFileName: null,
  review: null,
  history: { hasHistory: false, isComplete: true },
};

function decided(
  status: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
): MilestoneDocumentViewerSubmission {
  return {
    submitted: true,
    submittedAt: '2026-08-01T10:00:00+09:00',
    revision: 1,
    status,
    hasCurrentFile: true,
    currentFileName: '합성-학습-회고.pdf',
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
    await act(() => Promise.resolve(root.unmount()));
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
    await act(() => {
      root.render(
        <ProgramMilestones program={program(applicationStatus, due)} />,
      );
      return Promise.resolve();
    });

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

      expect(container.textContent).toContain(notice);

      const button = actionButton('올리기');
      expect(button.disabled).toBe(true);
      const note = blockedNote();
      expect(note?.textContent).toBe(buttonNote);
      expect(button.getAttribute('aria-describedby')).toBe(note?.id);

      await act(() => Promise.resolve(button.click()));
      expect(submissionInput()).toBeNull();
    },
  );

  it('마일스톤 블록에는 신청 경로를 두지 않는다', async () => {
    await render(null);

    const applyLinks = [...container.querySelectorAll('a')].filter(
      (anchor) =>
        anchor.textContent?.includes('신청') === true ||
        anchor.getAttribute('href')?.endsWith('/apply') === true,
    );
    expect(applyLinks).toEqual([]);
  });

  it('반려는 #1098 이전 화면 그대로 둔다', async () => {
    await render('REJECTED');

    expect(container.textContent).toContain('신청 승인 후 제출할 수 있습니다');
    expect(container.textContent).not.toContain('반려');

    const button = actionButton('올리기');
    expect(button.disabled).toBe(false);
    expect(blockedNote()).toBeNull();

    await act(() => Promise.resolve(button.click()));
    expect(submissionInput()).not.toBeNull();
  });

  it('승인된 학생의 첫 제출은 그대로 열려 있다', async () => {
    await render('APPROVED');

    const button = actionButton('올리기');
    expect(button.disabled).toBe(false);
    expect(blockedNote()).toBeNull();
    expect(container.textContent).toContain(
      '아래 제출 항목에서 내용이나 파일을 제출하세요',
    );

    await act(() => Promise.resolve(button.click()));
    expect(submissionInput()).not.toBeNull();
  });

  it.each([
    ['APPROVED' as const, '승인된 제출 항목은 다시 제출할 수 없습니다.'],
    ['REJECTED' as const, '반려된 제출 항목은 다시 제출할 수 없습니다.'],
  ])(
    '되돌린 승인 뒤 이미 %s 된 서류는 신청 안내가 아니라 그 서류의 이유를 말한다',
    async (documentStatus, settledNote) => {
      await render('SUBMITTED', { viewerSubmission: decided(documentStatus) });

      expect(container.textContent).toContain(settledNote);

      expect(container.textContent).not.toContain('승인 후 제출할 수 있습니다');
      expect(blockedNote()).toBeNull();

      expect(actionLabels()).not.toContain('수정');
    },
  );

  it('마감이 지난 첫 제출은 승인이 아니라 마감을 이유로 든다', async () => {
    await render('SUBMITTED', { due: PAST_DUE });

    const button = actionButton('올리기');
    expect(button.disabled).toBe(true);
    const note = blockedNote();
    expect(note?.textContent).toBe('마감이 지나 제출할 수 없습니다');
    expect(button.getAttribute('aria-describedby')).toBe(note?.id);
    expect(container.textContent).not.toContain('승인 후 제출할 수 있습니다');

    await act(() => Promise.resolve(button.click()));
    expect(submissionInput()).toBeNull();
  });

  it('마감 뒤 보완 요청은 마감이 아니라 신청 상태를 이유로 든다', async () => {
    await render('SUBMITTED', {
      due: PAST_DUE,
      viewerSubmission: decided('CHANGES_REQUESTED'),
    });

    expect(blockedNote()?.textContent).toBe('승인 후 제출할 수 있습니다');
    expect(container.textContent).not.toContain('마감이 지나');
  });
});
