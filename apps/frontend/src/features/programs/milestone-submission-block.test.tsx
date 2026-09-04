// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramMilestones } from './program-detail-view';
import type { MilestoneDocument } from './milestone-document-api';
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

const document_: MilestoneDocument = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: '학습 회고',
  required: true,
  sortOrder: 0,
  hasTemplateFile: false,
  templateFileName: null,
  viewerSubmission: {
    submitted: false,
    submittedAt: null,
    revision: null,
    status: null,
    hasCurrentFile: false,
    review: null,
    history: { hasHistory: false, isComplete: true },
  },
};

function program(applicationStatus: ApplicationStatus | null): ProgramDetail {
  return {
    id: 'program-1',
    name: '합성 기초 스터디',
    organizer: '운영기관',
    trackType: 'EXTRACURRICULAR',
    applicationTemplateKey: 'oss-contest',
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
        dueAt: '2099-08-20T23:59:59+09:00',
        dDay: 19,
        deadlineLabel: 'D-19',
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([document_]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(applicationStatus: ApplicationStatus | null) {
    await act(async () => {
      root.render(<ProgramMilestones program={program(applicationStatus)} />);
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('학습 회고');
    });
  }

  function uploadButton(): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '올리기',
    );
    if (!(found instanceof HTMLButtonElement)) {
      throw new TypeError('「올리기」 버튼을 찾지 못했습니다.');
    }
    return found;
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
    [
      'REJECTED' as const,
      '신청이 반려되어 제출할 수 없습니다. 반려 사유를 확인해 주세요.',
      '반려되어 제출할 수 없습니다',
    ],
  ])(
    '%s 상태에서는 위쪽 안내와 아래쪽 버튼이 같은 말을 한다',
    async (applicationStatus, notice, buttonNote) => {
      await render(applicationStatus);

      // 위: 왜 못 내는지.
      expect(container.textContent).toContain(notice);
      // 아래: 버튼은 남아 있되 눌리지 않고, 그 옆에 같은 판정에서 나온 이유가 붙는다.
      const button = uploadButton();
      expect(button.disabled).toBe(true);
      const note = container.querySelector(
        '[data-testid="milestone-document-blocked-note"]',
      );
      expect(note?.textContent).toBe(buttonNote);
      expect(button.getAttribute('aria-describedby')).toBe(note?.id);

      // 눌러도 제출 입력이 열리지 않는다.
      await act(async () => button.click());
      expect(submissionInput()).toBeNull();
    },
  );

  /** 신청 전에는 다음에 할 일이 있다 — 화면이 그 자리로 데려가야 한다. */
  it('신청 전에는 신청 화면으로 가는 경로를 함께 준다', async () => {
    await render(null);

    const apply = [...container.querySelectorAll('a')].find(
      (anchor) => anchor.textContent?.trim() === '신청하기',
    );
    expect(apply?.getAttribute('href')).toBe('/programs/program-1/apply');
  });

  /**
   * 변이 검증 대상 2 — 신청 게이트를 승인된 학생까지 넓히면 여기가 깨진다. 첫 제출과
   * 마감 전 교체가 함께 사라져 기능이 하나 없어진다.
   */
  it('승인된 학생의 첫 제출은 그대로 열려 있다', async () => {
    await render('APPROVED');

    const button = uploadButton();
    expect(button.disabled).toBe(false);
    expect(
      container.querySelector(
        '[data-testid="milestone-document-blocked-note"]',
      ),
    ).toBeNull();
    expect(container.textContent).toContain(
      '아래 제출 항목에서 내용이나 파일을 제출하세요',
    );

    await act(async () => button.click());
    expect(submissionInput()).not.toBeNull();
  });
});
