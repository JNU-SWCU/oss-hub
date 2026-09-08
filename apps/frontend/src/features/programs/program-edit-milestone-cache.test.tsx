// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditableMilestone, EditableProgram } from './api';
import { ProgramEditPage } from './program-edit-page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const {
  getEditableProgramMock,
  getEditableMilestoneMock,
  updateEditableMilestoneMock,
  updateProgramMock,
} = vi.hoisted(() => ({
  getEditableProgramMock: vi.fn(),
  getEditableMilestoneMock: vi.fn(),
  updateEditableMilestoneMock: vi.fn(),
  updateProgramMock: vi.fn(),
}));

vi.mock('./api', () => ({
  getEditableProgram: getEditableProgramMock,
  getEditableMilestone: getEditableMilestoneMock,
  updateEditableMilestone: updateEditableMilestoneMock,
  editableMilestoneSnapshotFailure: () => ({ kind: 'unknown' }),
  updateProgram: updateProgramMock,
  createMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
}));
vi.mock('./milestone-document-api', () => ({
  listMilestoneDocuments: vi.fn().mockResolvedValue({
    documents: [],
    fileUpload: {
      maxBytes: 5242880,
      maxLabel: '5 MiB',
      accept: '.pdf',
      formatLabel: 'PDF',
    },
  }),
}));

const originalMilestone: EditableMilestone = {
  id: 'milestone-1',
  name: '결과물 제출',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-30T09:30:59.000Z',
  submissionType: 'TEXT',
  instructions: '결과를 제출해 주세요.',
};

const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS 프로그램',
  organizer: 'SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'oss-contest',
  lifecycle: 'PUBLISHED',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  startAt: '2026-08-16T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: '프로그램 설명',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [originalMilestone],
};

describe('프로그램 편집 마일스톤 일정 동기화', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    getEditableProgramMock.mockReset();
    getEditableMilestoneMock.mockReset().mockResolvedValue({
      milestone: originalMilestone,
      operation: {
        startAt: editableProgram.startAt,
        endAt: editableProgram.endAt,
      },
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
      fingerprint: 'a'.repeat(64),
    });
    updateEditableMilestoneMock.mockReset();
    updateProgramMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('마일스톤 마감을 앞당긴 직후 새 마감 이후의 프로그램 종료일을 저장한다', async () => {
    const savedMilestoneDueAt = '2026-08-20T09:30:00.000Z';
    const savedProgramEndAt = '2026-08-25T09:30:00.000Z';
    const savedMilestone: EditableMilestone = {
      ...originalMilestone,
      dueAt: savedMilestoneDueAt,
    };
    getEditableProgramMock.mockResolvedValue(editableProgram);
    updateEditableMilestoneMock.mockResolvedValue({
      milestone: savedMilestone,
      operation: {
        startAt: editableProgram.startAt,
        endAt: editableProgram.endAt,
      },
      documents: [],
      fileUpload: {
        maxBytes: 5242880,
        maxLabel: '5 MiB',
        accept: '.pdf',
        formatLabel: 'PDF',
      },
      fingerprint: 'b'.repeat(64),
    });
    updateProgramMock.mockResolvedValue({
      ...editableProgram,
      endAt: savedProgramEndAt,
      milestones: [savedMilestone],
    });

    await act(async () => {
      root.render(
        <ProgramEditPage programId="program-1" canDeleteProgram={false} />,
      );
      await Promise.resolve();
    });

    await act(async () =>
      getAccessibleButton(`${originalMilestone.name} 수정`).click(),
    );
    await selectRange('결과물 제출', '2026-08-16', '2026-08-20');
    await act(async () => {
      getButton('마일스톤 저장').click();
      await Promise.resolve();
    });

    await act(async () => getAccessibleButton('운영 기간 수정').click());
    await selectRange('운영 기간', '2026-08-16', '2026-08-25');
    await act(async () => {
      getButton('날짜 적용').click();
    });
    await act(async () => {
      getButton('프로그램 정보 저장').click();
      await Promise.resolve();
    });

    expect(updateEditableMilestoneMock).toHaveBeenCalledWith(
      'milestone-1',
      expect.objectContaining({ dueAt: savedMilestone.dueAt }),
    );
    expect(updateProgramMock).toHaveBeenCalledWith(
      'program-1',
      expect.objectContaining({ endAt: savedProgramEndAt }),
    );
  });
});

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Button not found: ${name}`);
  }
  return button;
}

function getAccessibleButton(name: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${name}"]`,
  );
  if (button === null) throw new TypeError(`Button not found: ${name}`);
  return button;
}

async function selectRange(
  label: string,
  start: string,
  end: string,
): Promise<void> {
  const calendar = document.querySelector<HTMLElement>(
    `[aria-label="${label} 날짜 선택 달력"]`,
  );
  const startButton = calendar?.querySelector<HTMLButtonElement>(
    `[data-calendar-date="${start}"]`,
  );
  if (startButton === null || startButton === undefined) {
    throw new TypeError(`Calendar range not found: ${start}–${end}`);
  }
  await act(async () => startButton.click());
  const endButton = calendar?.querySelector<HTMLButtonElement>(
    `[data-calendar-date="${end}"]`,
  );
  if (endButton === null || endButton === undefined) {
    throw new TypeError(`Calendar range not found: ${start}–${end}`);
  }
  await act(async () => endButton.click());
}
