import { act } from 'react';
import { apiPath } from '@/lib/api-client';
import { teamManagementPage } from '../../../../test-support/team-management-page.fixture';
import type { Root } from 'react-dom/client';
import { createListScreenRoot as createRoot } from '../../../../test-support/list-screen-root';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { listStaffProgramTeams } from '../teams/api';
import {
  createProgramDocumentChangeRequest,
  getProgramDocumentChangeRequestTargets,
} from './program-document-change-request-api';
import { ProgramDocumentChangeRequestPanel } from './program-document-change-request-panel';

vi.mock('../teams/api', () => ({
  listStaffProgramTeams: vi.fn(),
}));
vi.mock('./program-document-change-request-api', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('./program-document-change-request-api')
    >();
  return {
    ...actual,
    getProgramDocumentChangeRequestTargets: vi.fn(),
    createProgramDocumentChangeRequest: vi.fn(),
  };
});
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const TARGETS = {
  submitted: 2,
  changesRequested: 1,
  approved: 1,
  rejected: 0,
  version: 'a'.repeat(64),
} as const;

let root: Root;
let container: HTMLDivElement;
const onSent = vi.fn();

beforeEach(async () => {
  vi.mocked(listStaffProgramTeams)
    .mockReset()
    .mockResolvedValue([{ teamId: 'team-1', name: '예시 팀 가' }]);
  vi.mocked(getProgramDocumentChangeRequestTargets)
    .mockReset()
    .mockResolvedValue(TARGETS);
  vi.mocked(createProgramDocumentChangeRequest)
    .mockReset()
    .mockResolvedValue({ requestedCount: 3 });
  onSent.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <ProgramDocumentChangeRequestPanel
        programId="program-1"
        onSent={onSent}
      />,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function dialog(): HTMLElement | null {
  return document.querySelector('[role="alertdialog"]');
}

function button(label: string, root: ParentNode = document): HTMLButtonElement {
  const value = [...root.querySelectorAll('button')].find(
    (item) =>
      (item.getAttribute('aria-label') ?? item.textContent?.trim()) === label,
  );
  if (!value) throw new TypeError(`Missing ${label}`);
  return value;
}

function inDialog(label: string): HTMLButtonElement {
  const root = dialog();
  if (!root) throw new TypeError('Missing dialog');
  return button(label, root);
}

function targetsText(): string {
  return (
    document.querySelector(
      '[data-testid="program-document-change-request-targets"]',
    )?.textContent ?? ''
  );
}

async function open() {
  await act(async () => button('보완 요청 보내기').click());
}

async function type(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector,
  );
  if (!field) throw new TypeError(`Missing ${selector}`);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function fillReason() {
  await type('textarea', '양식을 바꿔 다시 내 주세요.');
}

it('범위 안 제출 수를 상태별로 보여 주고 이미 끝난 판정은 체크해야 더한다', async () => {
  await open();

  expect(getProgramDocumentChangeRequestTargets).toHaveBeenCalledWith(
    'program-1',
    { kind: 'PROGRAM' },
  );
  expect(targetsText()).toContain('검토 대기 2건 · 보완 요청 중 1건');
  expect(targetsText()).toContain('승인·반려한 1건은 빠집니다.');
  expect(inDialog('3건 보완 요청 보내기').disabled).toBe(false);

  const finals = document.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  await act(async () => finals?.click());

  expect(targetsText()).toContain(
    '검토 대기 2건 · 보완 요청 중 1건 · 승인 1건',
  );
  expect(targetsText()).not.toContain('빠집니다');
  expect(inDialog('4건 보완 요청 보내기').disabled).toBe(false);
  expect(getProgramDocumentChangeRequestTargets).toHaveBeenCalledTimes(1);
});

it('sends a bulk request without a reason or deadline', async () => {
  await open();
  expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
  await act(async () => inDialog('3건 보완 요청 보내기').click());
  expect(createProgramDocumentChangeRequest).toHaveBeenCalledWith('program-1', {
    scope: { kind: 'PROGRAM' },
    includeFinalDecisions: false,
    comment: undefined,
    expectedVersion: 'a'.repeat(64),
  });
  expect(dialog()?.textContent).toContain('제출 3건에 보완 요청을 보냈습니다.');
});

it('cancelling discards the optional reason without sending', async () => {
  await open();
  await type('textarea', '작성 중인 사유');
  await act(async () => inDialog('취소').click());
  expect(dialog()).toBeNull();
  await open();
  expect(document.querySelector('textarea')?.value).toBe('');
  expect(createProgramDocumentChangeRequest).not.toHaveBeenCalled();
});

it('보내면 확인한 건수와 함께 보내고 표를 다시 부르며 닫기로 끝낸다', async () => {
  await open();
  await fillReason();
  await act(async () => inDialog('3건 보완 요청 보내기').click());

  expect(createProgramDocumentChangeRequest).toHaveBeenCalledWith('program-1', {
    scope: { kind: 'PROGRAM' },
    includeFinalDecisions: false,
    comment: '양식을 바꿔 다시 내 주세요.',
    expectedVersion: 'a'.repeat(64),
  });
  expect(onSent).toHaveBeenCalledTimes(1);
  expect(dialog()?.textContent).toContain('제출 3건에 보완 요청을 보냈습니다.');
  expect(document.activeElement).toBe(inDialog('닫기'));

  await act(async () => inDialog('닫기').click());
  expect(dialog()).toBeNull();
});

it('그사이 대상이 바뀌었으면 표를 바꾸지 않고 건수를 다시 센다', async () => {
  vi.mocked(createProgramDocumentChangeRequest).mockRejectedValueOnce(
    new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: '검토하는 사이에 제출물 또는 검토 결과가 바뀌었습니다.',
      instance: 'programs/program-1/documents/change-requests',
      code: 'MSD_025',
    }),
  );
  await open();
  await fillReason();
  await act(async () => inDialog('3건 보완 요청 보내기').click());

  expect(onSent).not.toHaveBeenCalled();
  expect(dialog()?.textContent).toContain(
    '그사이 제출이나 판정이 바뀌어 보낼 제출 수를 다시 셌습니다.',
  );
  expect(getProgramDocumentChangeRequestTargets).toHaveBeenCalledTimes(2);
});

it('팀 범위를 고르면 그 팀만 세고, 보낼 제출이 없으면 보낼 수 없다', async () => {
  vi.mocked(getProgramDocumentChangeRequestTargets).mockResolvedValue({
    submitted: 0,
    changesRequested: 0,
    approved: 0,
    rejected: 0,
    version: 'b'.repeat(64),
  });
  await open();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[value="TEAM"]')?.click(),
  );
  expect(targetsText()).toContain('팀을 선택하면 보낼 제출 수를 보여 줍니다.');

  const team = document.querySelector('select');
  if (!team) throw new TypeError('Missing team select');
  await act(async () => {
    team.value = 'team-1';
    team.dispatchEvent(new Event('change', { bubbles: true }));
  });

  expect(getProgramDocumentChangeRequestTargets).toHaveBeenLastCalledWith(
    'program-1',
    { kind: 'TEAM', teamId: 'team-1' },
  );
  expect(targetsText()).toContain(
    '이 범위에는 보완 요청을 보낼 제출이 없습니다.',
  );
  expect(inDialog('보완 요청 보내기').disabled).toBe(true);
});

it('팀 목록을 못 불러오면 팀 없음으로 보이지 않고 다시 불러오게 한다', async () => {
  vi.mocked(listStaffProgramTeams).mockRejectedValueOnce(
    new TypeError('offline'),
  );
  await open();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[value="TEAM"]')?.click(),
  );

  expect(dialog()?.textContent).toContain('팀 목록을 불러오지 못했습니다.');
  expect(dialog()?.textContent).not.toContain('팀 없음');
  expect(document.querySelector('select')?.disabled).toBe(true);

  await act(async () => inDialog('팀 목록 다시 불러오기').click());

  expect(listStaffProgramTeams).toHaveBeenCalledTimes(2);
  expect(dialog()?.textContent).not.toContain('팀 목록을 불러오지 못했습니다.');
  expect(document.querySelector('select')?.disabled).toBe(false);
  expect(dialog()?.textContent).toContain('예시 팀 가');
});

afterEach(() => vi.unstubAllGlobals());
it('실제 페이지 응답으로 보완 요청 팀 선택지 101개를 표시한다', async () => {
  const actual =
    await vi.importActual<typeof import('../teams/api')>('../teams/api');
  vi.mocked(listStaffProgramTeams).mockImplementation(
    actual.listStaffProgramTeams,
  );
  const pages: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((request: string) => {
      const url = new URL(request, 'https://fixture.invalid');
      if (url.pathname !== apiPath('programs/program-1/teams'))
        throw new Error('Unexpected test request ' + url.pathname);
      const page = Number(url.searchParams.get('page') ?? '1');
      pages.push(page);
      return Promise.resolve(
        new Response(JSON.stringify(teamManagementPage(page)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  await open();
  const kind = document.body.querySelector<HTMLInputElement>(
    'input[type="radio"][value="TEAM"]',
  );
  if (!kind) throw new Error('Missing team scope radio');
  await act(async () => {
    kind.click();
    await vi.waitFor(() => expect(pages).toEqual([1, 2]));
  });
  expect(
    document.body.querySelector('option[value="team-101"]')?.textContent,
  ).toBe('합성 팀 101');
  expect(document.body.querySelectorAll('option[value^="team-"]')).toHaveLength(
    101,
  );
  expect(pages).toEqual([1, 2]);
});
