// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getProgramDetail, listStaffProgramTeams } from './api';
import { downloadProgramDocumentArchive } from './program-document-archive-api';
import { ProgramDocumentArchivePanel } from './program-document-archive-panel';
import { programDetailFor } from '../../../test-support/local-review/handlers/student-program-fixtures';

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
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  const program = programDetailFor('program-capstone', 'STAFF');
  vi.mocked(getProgramDetail)
    .mockReset()
    .mockResolvedValue({
      ...program,
      name: '예시 프로그램',
      milestones: program.milestones.map((milestone, index) => ({
        ...milestone,
        id: `stage-${index + 1}`,
        name: index === 0 ? '계획' : '결과',
      })),
    });
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
async function open() {
  await act(async () => button('제출 자료 ZIP 내려받기').click());
}

it('opens in the originating milestone with current-only summary before any download', async () => {
  expect(getProgramDetail).not.toHaveBeenCalled();
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
  const program = programDetailFor('program-capstone', 'STAFF');
  vi.mocked(getProgramDetail).mockResolvedValue(program);
  await open();
  expect(button('ZIP 내려받기').disabled).toBe(true);
  expect(downloadProgramDocumentArchive).not.toHaveBeenCalled();
});
