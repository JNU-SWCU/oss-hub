// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getProgramDetail, listStaffProgramTeams } from './api';
import { downloadProgramDocumentArchive } from './program-document-archive-api';
import { ProgramDocumentArchivePanel } from './program-document-archive-panel';
import type { ProgramDetail, ProgramMilestone } from './types';

vi.mock('./api', () => ({
  getProgramDetail: vi.fn(),
  listStaffProgramTeams: vi.fn(),
}));
vi.mock('./program-document-archive-api', () => ({
  downloadProgramDocumentArchive: vi.fn(),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function milestone(id: string, name: string): ProgramMilestone {
  return {
    id,
    name,
    dueAt: '2026-08-01T00:00:00.000Z',
    dDay: 1,
    deadlineLabel: 'D-1',
    description: null,
    submissionType: null,
    submissionItemCount: 0,
    viewerSubmissionStatus: null,
    applicationSubmissionSummary: null,
  };
}

function archiveProgram(
  milestones: readonly ProgramMilestone[],
): ProgramDetail {
  return {
    id: 'program-1',
    name: '예시 프로그램',
    organizer: '합성 운영기관',
    trackType: 'EXTRACURRICULAR',
    applicationTemplateKey: 'basic',
    lifecycle: 'PUBLISHED',
    description: '합성 설명',
    repositoryProvisioningEnabled: false,
    applicationPeriod: {
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-08-31T23:59:59.000Z',
    },
    viewer: { role: 'STAFF', applicationStatus: null },
    milestones,
  };
}

const PLAN_AND_RESULT = [
  milestone('stage-1', '계획'),
  milestone('stage-2', '결과'),
] as const;

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.mocked(getProgramDetail)
    .mockReset()
    .mockResolvedValue(archiveProgram(PLAN_AND_RESULT));
  vi.mocked(listStaffProgramTeams)
    .mockReset()
    .mockResolvedValue([
      { teamId: 'team-1', name: '예시 팀', memberCount: 0, members: [] },
    ]);
  vi.mocked(downloadProgramDocumentArchive)
    .mockReset()
    .mockRejectedValue(new Error('synthetic failure'));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <ProgramDocumentArchivePanel
        programId="program-1"
        initialMilestoneId="stage-2"
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function button(label: string): HTMLButtonElement {
  const value = [...container.querySelectorAll('button')].find(
    (item) => (item.getAttribute('aria-label') ?? item.textContent) === label,
  );
  if (!value) throw new TypeError(`Missing ${label}`);
  return value;
}
function toggle(): HTMLButtonElement {
  return button('제출 자료 ZIP 내려받기');
}
async function open() {
  await act(async () => toggle().click());
}

it('opens in the originating milestone with current-only summary before any download', async () => {
  expect(getProgramDetail).not.toHaveBeenCalled();
  expect(toggle().textContent?.trim()).toBe('내려받기');
  expect(toggle().getAttribute('aria-label')).toBe('제출 자료 ZIP 내려받기');
  expect(toggle().getAttribute('title')).toBe('제출 자료 ZIP 내려받기');
  await open();
  expect(
    container.querySelector('[data-testid="program-document-archive-summary"]')
      ?.textContent,
  ).toContain('예시 프로그램 · 결과');
  expect(container.textContent).toContain('현재 제출 글과 파일');
  expect(container.textContent).toContain('이전 제출 이력은 포함하지 않습니다');
  expect(container.textContent).toContain('목록의 검색·필터와 별개');
  expect(downloadProgramDocumentArchive).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps team and grouping choices after a download failure and retries explicitly', async () => {
  await open();
  const team = container.querySelector<HTMLInputElement>('input[value="TEAM"]');
  if (!team) throw new TypeError('Missing team scope');
  await act(async () => team.click());
  const grouping = [...container.querySelectorAll('select')].find((item) =>
    item.textContent?.includes('서류별로 묶기'),
  );
  if (!grouping) throw new TypeError('Missing grouping');
  await act(async () => {
    grouping.value = 'DOCUMENT';
    grouping.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('ZIP 내려받기').click());
  expect(downloadProgramDocumentArchive).toHaveBeenCalledWith(
    'program-1',
    { kind: 'TEAM', teamId: 'team-1' },
    'DOCUMENT',
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    '선택한 범위를 확인',
  );
  expect(grouping.value).toBe('DOCUMENT');
  expect(team.checked).toBe(true);
  await act(async () => button('ZIP 내려받기').click());
  expect(downloadProgramDocumentArchive).toHaveBeenCalledTimes(2);
});

it('offers retry after scope loading fails without issuing a download', async () => {
  vi.mocked(listStaffProgramTeams).mockRejectedValueOnce(
    new Error('synthetic failure'),
  );
  await open();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    '불러오지 못했습니다',
  );
  await act(async () => button('다시 시도').click());
  expect(container.textContent).toContain('예시 프로그램 · 결과');
  expect(downloadProgramDocumentArchive).not.toHaveBeenCalled();
});

it('does not submit an empty team selection', async () => {
  vi.mocked(listStaffProgramTeams).mockResolvedValue([]);
  await open();
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[value="TEAM"]')?.click(),
  );
  expect(button('ZIP 내려받기').disabled).toBe(true);
  expect(container.textContent).toContain('선택 가능한 팀 없음');
  expect(downloadProgramDocumentArchive).not.toHaveBeenCalled();
});

it('requires a fresh milestone choice when the originating milestone no longer exists', async () => {
  vi.mocked(getProgramDetail).mockResolvedValue(
    archiveProgram([milestone('stage-1', '계획')]),
  );
  await open();
  expect(button('ZIP 내려받기').disabled).toBe(true);
  expect(downloadProgramDocumentArchive).not.toHaveBeenCalled();
});
