import { submissionUploadLimit } from '../../../test-support/submission-upload-limit';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { act, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../test-support/render-with-query';
import { createListScreenRoot as createRoot } from '../../../test-support/list-screen-root';
function renderToStaticMarkup(element: ReactNode) {
  return renderMarkup(
    <QueryClientProvider client={createTestQueryClient()}>
      {element}
    </QueryClientProvider>,
  );
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});
import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import {
  checkSubmissionFile,
  createResubmission,
  getSubmissionChecklist,
  uploadSubmissionFile,
} from './api';
import { SubmissionChecklistPage } from './submission-checklist-page';
import { ChecklistRow } from './components/submission-checklist-row';
import { SelectedMilestonePanel } from './components/submission-checklist-selected-panel';
import type { SubmissionChecklistViewProps } from './components/submission-checklist-view';
import type { SubmissionChecklist } from './types';

const pageView = vi.hoisted(() => ({
  props: null as SubmissionChecklistViewProps | null,
}));

const fallbackScreens = vi.hoisted(() => ({
  loadFailure: 0,
  participationRequired: 0,
  participationProgramId: null as string | null,
}));

const initialSubmissionPage = vi.hoisted(() => ({
  props: null as {
    readonly onSubmitted: () => void;
    readonly onSubmittingChange?: (submitting: boolean) => void;
  } | null,
  posts: 0,
  resolvePost: null as (() => void) | null,
}));

vi.mock('./api', () => ({
  checkSubmissionFile: vi.fn(),
  createResubmission: vi.fn(),
  getSubmissionChecklist: vi.fn(),
  uploadSubmissionFile: vi.fn(),
}));

vi.mock('./components/submission-checklist-view', () => ({
  ChecklistLoadFailure: () => {
    fallbackScreens.loadFailure += 1;
    return null;
  },
  ChecklistParticipationRequired: ({
    programId,
  }: {
    readonly programId: string;
  }) => {
    fallbackScreens.participationRequired += 1;
    fallbackScreens.participationProgramId = programId;
    return null;
  },
  ChecklistSkeleton: () => null,
  SubmissionChecklistView: (props: SubmissionChecklistViewProps) => {
    pageView.props = props;
    return null;
  },
}));

vi.mock('./submission-page', () => ({
  SubmissionPage: (props: {
    readonly onSubmitted: () => void;
    readonly onSubmittingChange?: (submitting: boolean) => void;
  }) => {
    initialSubmissionPage.props = props;
    return null;
  },
}));

const CHECKLIST: SubmissionChecklist = {
  applicationId: 'application-1',
  applicationMode: 'PERSONAL',
  fileUpload: submissionUploadLimit(),
  items: [
    {
      milestoneId: 'milestone-file',
      name: 'File replacement',
      dueAt: '2026-09-01T14:59:59.000Z',
      submissionType: 'FILE',
      submission: {
        id: 'submission-1',
        status: 'CHANGES_REQUESTED',
        currentRevision: 3,
        decision: 'CHANGES_REQUESTED',
        lastReviewedAt: '2026-08-28T01:00:00.000Z',
        reviewComment: 'Replace the file',
        canResubmit: true,
        file: null,
      },
    },
  ],
};

const FILE = new File(['%PDF'], 'r.pdf', { type: 'application/pdf' });

const CREATED_RESUBMISSION = {
  submissionId: 'submission-1',
  revision: 4,
  status: 'SUBMITTED',
} as const;

function uploaded(fileId: string) {
  return {
    fileId,
    fileName: 'r.pdf',
    contentType: 'application/pdf',
    size: 4,
    expiresAt: '2026-09-02T00:00:00.000Z',
  };
}

function problem(code: string, detail: string = code): ProblemDetail {
  return {
    type: 'about:blank',
    title: code,
    status: 503,
    detail,
    instance: '/synthetic/submissions/submission-1/resubmissions',
    code,
  };
}

function currentViewProps(): SubmissionChecklistViewProps {
  if (pageView.props === null) {
    throw new Error('expected checklist view props');
  }
  return pageView.props;
}

let selectedMilestoneId: string | null = 'milestone-file';
let closeSelected: ReturnType<typeof vi.fn>;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function renderPage(): void {
  act(() =>
    root.render(
      <SubmissionChecklistPage
        programId="program-1"
        milestoneId={selectedMilestoneId}
        onCloseSelected={closeSelected}
      />,
    ),
  );
}
function renderPendingSelection(): void {
  root.render(
    <SubmissionChecklistPage
      programId="program-1"
      milestoneId={selectedMilestoneId}
      onCloseSelected={closeSelected}
    />,
  );
}
async function flushAsyncWork(): Promise<void> {
  await act(async () => {});
}
async function renderReadyPage(): Promise<void> {
  await act(async () => renderPage());
}

async function selectFileAndSubmit(file: File): Promise<void> {
  act(() => currentViewProps().onFileChange(file));
  renderPage();
  act(() => currentViewProps().onResubmit());
  await flushAsyncWork();
  renderPage();
}

async function submitInitialPost(): Promise<void> {
  const initialSubmission = currentViewProps().initialSubmission;
  if (
    !isValidElement<{
      readonly onSubmitted: () => void;
      readonly onSubmittingChange?: (submitting: boolean) => void;
    }>(initialSubmission)
  ) {
    throw new Error('expected initial submission element');
  }
  const props = initialSubmission.props;
  initialSubmissionPage.posts += 1;
  act(() => props.onSubmittingChange?.(true));
  await new Promise<void>((resolve) => {
    initialSubmissionPage.resolvePost = resolve;
  });
  act(() => props.onSubmittingChange?.(false));
  act(() => props.onSubmitted());
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  pageView.props = null;
  selectedMilestoneId = 'milestone-file';
  closeSelected = vi.fn(() => {
    selectedMilestoneId = null;
  });
  initialSubmissionPage.props = null;
  initialSubmissionPage.posts = 0;
  initialSubmissionPage.resolvePost = null;
  fallbackScreens.loadFailure = 0;
  fallbackScreens.participationRequired = 0;
  fallbackScreens.participationProgramId = null;
  vi.mocked(getSubmissionChecklist).mockReset();
  vi.mocked(uploadSubmissionFile).mockReset();
  vi.mocked(createResubmission).mockReset();
  vi.mocked(checkSubmissionFile).mockReset();
  vi.mocked(getSubmissionChecklist).mockResolvedValue(CHECKLIST);
  vi.mocked(checkSubmissionFile).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('SubmissionChecklistPage FILE resubmission retry cache', () => {
  it('상한 초과 오류 뒤 보완 파일을 바꾸면 이전 오류를 지운다', async () => {
    vi.mocked(getSubmissionChecklist).mockResolvedValue({
      ...CHECKLIST,
      fileUpload: { maxBytes: 2 * 1024 * 1024, maxLabel: '2 MB' },
    });
    await renderReadyPage();
    await selectFileAndSubmit(
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.pdf', {
        type: 'application/pdf',
      }),
    );
    expect(currentViewProps().errors.file).toBe('파일은 2 MB 이하여야 합니다.');
    expect(uploadSubmissionFile).not.toHaveBeenCalled();

    act(() => currentViewProps().onFileChange(FILE));
    renderPage();
    expect(currentViewProps().input.file).toBe(FILE);
    expect(currentViewProps().errors.file).toBeUndefined();
    expect(currentViewProps().fileError).toBeNull();
    expect(uploadSubmissionFile).not.toHaveBeenCalled();
  });

  it('보완 요청 상태면 canResubmit이 false여도 재제출 API를 요청한다', async () => {
    const [item] = CHECKLIST.items;
    if (!item?.submission) throw new Error('expected resubmission fixture');
    vi.mocked(getSubmissionChecklist).mockResolvedValue({
      ...CHECKLIST,
      items: [
        {
          ...item,
          submission: { ...item.submission, canResubmit: false },
        },
      ],
    });
    vi.mocked(uploadSubmissionFile).mockResolvedValue(uploaded('file-first'));
    vi.mocked(createResubmission).mockResolvedValue(CREATED_RESUBMISSION);
    await renderReadyPage();

    await selectFileAndSubmit(FILE);

    expect(createResubmission).toHaveBeenCalledWith({
      submissionId: 'submission-1',
      baseRevision: 3,
      content: { type: 'FILE', fileId: 'file-first' },
      comment: '',
    });
  });

  it('coalesces repeated submits from the same render into one upload and revision request', async () => {
    const pendingUpload = {
      resolve: null as ((value: ReturnType<typeof uploaded>) => void) | null,
    };
    vi.mocked(uploadSubmissionFile).mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingUpload.resolve = resolve;
        }),
    );
    vi.mocked(createResubmission).mockResolvedValue(CREATED_RESUBMISSION);
    await renderReadyPage();
    act(() => currentViewProps().onFileChange(FILE));
    renderPage();

    act(() => currentViewProps().onResubmit());
    act(() => currentViewProps().onResubmit());
    await flushAsyncWork();

    expect(uploadSubmissionFile).toHaveBeenCalledTimes(1);
    if (pendingUpload.resolve === null) {
      throw new Error('expected upload request to be pending');
    }
    await act(async () => pendingUpload.resolve?.(uploaded('file-first')));
    await flushAsyncWork();
    expect(createResubmission).toHaveBeenCalledTimes(1);
  });

  it('재제출 성공 토스트는 내부 용어 revision 없이 제출본 번호를 알려준다', async () => {
    vi.mocked(uploadSubmissionFile).mockResolvedValue(uploaded('file-first'));
    vi.mocked(createResubmission).mockResolvedValue(CREATED_RESUBMISSION);
    await renderReadyPage();

    await selectFileAndSubmit(FILE);

    const toast = currentViewProps().toastMessage ?? '';
    expect(toast).toBe(
      '제출본 4번을 제출했습니다. 검토 대기 상태로 전환되었습니다.',
    );
    expect(toast).not.toMatch(/revision/i);
  });

  it('discards the cached upload id when create-resubmission returns SUB_010', async () => {
    vi.mocked(uploadSubmissionFile)
      .mockResolvedValueOnce(uploaded('file-first'))
      .mockResolvedValueOnce(uploaded('file-second'));
    vi.mocked(createResubmission)
      .mockRejectedValueOnce(new ApiError(problem('SUB_010')))
      .mockResolvedValueOnce(CREATED_RESUBMISSION);

    await renderReadyPage();
    await selectFileAndSubmit(FILE);
    await selectFileAndSubmit(FILE);

    expect(uploadSubmissionFile).toHaveBeenCalledTimes(2);
    expect(uploadSubmissionFile).toHaveBeenNthCalledWith(
      2,
      'application-1',
      'milestone-file',
      FILE,
      { submissionId: 'submission-1', baseRevision: 3 },
    );
    expect(createResubmission).toHaveBeenNthCalledWith(2, {
      submissionId: 'submission-1',
      baseRevision: 3,
      content: { type: 'FILE', fileId: 'file-second' },
      comment: '',
    });
  });

  it('압축 파일 내용 거절은 서버 문장을 파일 입력 옆에 세운다', async () => {
    const detail =
      '압축 파일 안에 또 다른 압축 파일이 있습니다. 안쪽 압축을 풀고 다시 압축해 주세요.';
    vi.mocked(uploadSubmissionFile).mockRejectedValueOnce(
      new ApiError(problem('SUB_027', detail)),
    );

    await renderReadyPage();
    await selectFileAndSubmit(FILE);

    expect(currentViewProps().fileError).toBe(detail);
    expect(currentViewProps().fileError).not.toBe(
      'PDF, HWP, ZIP 파일만 제출할 수 있습니다.',
    );
  });

  it('ZIP을 고르면 재제출을 누르지 않아도 판정 대기와 거절 문장을 파일 입력에 넘긴다', async () => {
    const detail =
      '비밀번호가 걸린 압축 파일은 제출할 수 없습니다. 비밀번호 없이 다시 압축해 주세요.';
    vi.mocked(checkSubmissionFile).mockRejectedValueOnce(
      new ApiError(problem('SUB_028', detail)),
    );
    const locked = new File(['PK'], 'locked.zip', { type: 'application/zip' });
    await renderReadyPage();

    act(() => currentViewProps().onFileChange(locked));
    renderPage();

    expect(currentViewProps().fileChecking).toBe(true);
    expect(currentViewProps().fileError).toBeNull();

    await flushAsyncWork();
    renderPage();

    expect(checkSubmissionFile).toHaveBeenCalledWith(locked);
    expect(currentViewProps().fileChecking).toBe(false);
    expect(currentViewProps().fileError).toBe(detail);
    expect(uploadSubmissionFile).not.toHaveBeenCalled();
    expect(createResubmission).not.toHaveBeenCalled();

    act(() => currentViewProps().onFileChange(FILE));
    renderPage();

    expect(currentViewProps().fileError).toBeNull();
    expect(checkSubmissionFile).toHaveBeenCalledTimes(1);
  });

  it('판정 요청이 판정이 아닌 이유로 실패하면 파일 입력에 아무 말도 붙이지 않는다', async () => {
    vi.mocked(checkSubmissionFile).mockRejectedValueOnce(
      new ApiError(problem('AUTH_001', '로그인이 필요합니다.')),
    );
    await renderReadyPage();

    act(() =>
      currentViewProps().onFileChange(
        new File(['PK'], 'bundle.zip', { type: 'application/zip' }),
      ),
    );
    renderPage();
    await flushAsyncWork();
    renderPage();

    expect(checkSubmissionFile).toHaveBeenCalledTimes(1);
    expect(currentViewProps().fileChecking).toBe(false);
    expect(currentViewProps().fileError).toBeNull();
    expect(currentViewProps().serverError).toBeNull();
  });

  it('keeps the cached upload id for other retryable create-resubmission server errors', async () => {
    vi.mocked(uploadSubmissionFile).mockResolvedValue(uploaded('file-first'));
    vi.mocked(createResubmission)
      .mockRejectedValueOnce(new ApiError(problem('SUB_999')))
      .mockResolvedValueOnce(CREATED_RESUBMISSION);

    await renderReadyPage();
    await selectFileAndSubmit(FILE);
    await selectFileAndSubmit(FILE);

    expect(uploadSubmissionFile).toHaveBeenCalledTimes(1);
    expect(createResubmission).toHaveBeenNthCalledWith(2, {
      submissionId: 'submission-1',
      baseRevision: 3,
      content: { type: 'FILE', fileId: 'file-first' },
      comment: '',
    });
  });
});

describe('SubmissionChecklistPage 재제출 직후 화면', () => {
  it('새로고침 없이도 지난 보완 요청 이력이 줄과 창에 남는다', async () => {
    vi.mocked(getSubmissionChecklist)
      .mockResolvedValueOnce(CHECKLIST)
      .mockResolvedValue({
        ...CHECKLIST,
        items: CHECKLIST.items.map((item) => ({
          ...item,
          submission:
            item.submission === null
              ? null
              : { ...item.submission, status: 'SUBMITTED', currentRevision: 4 },
        })),
      });
    vi.mocked(uploadSubmissionFile).mockResolvedValue(uploaded('file-first'));
    vi.mocked(createResubmission).mockResolvedValue(CREATED_RESUBMISSION);
    await renderReadyPage();

    await selectFileAndSubmit(FILE);

    const props = currentViewProps();
    expect(getSubmissionChecklist).toHaveBeenCalledTimes(2);
    const item = props.checklist.items[0];
    if (!item) throw new Error('expected checklist item');

    const row = renderToStaticMarkup(
      <ChecklistRow programId={props.programId} item={item} now={props.now} />,
    );
    expect(row).toContain('제출 상태: </span>검토 대기');
    expect(row).toContain('이전 검토 결과: 보완 요청');

    const panel = renderToStaticMarkup(
      <SelectedMilestonePanel
        fileUpload={props.checklist.fileUpload}
        programId={props.programId}
        item={item}
        input={props.input}
        comment={props.comment}
        errors={props.errors}
        fileError={props.fileError}
        submitting={props.submitting}
        submissionPhase={props.submissionPhase}
        onCloseSelected={props.onCloseSelected}
        onTextChange={props.onTextChange}
        onFileChange={props.onFileChange}
        onCommentChange={props.onCommentChange}
        onResubmit={props.onResubmit}
      />,
    );
    expect(panel).toContain('최근 검토 결과');
    expect(panel).toContain('Replace the file');
    expect(panel).toContain('현재 제출본');
  });
});

describe('SubmissionChecklistPage initial submission refresh', () => {
  it('성공 화면을 닫기 전에는 갱신하지 않고 실패해도 기존 목록을 보존한다', async () => {
    const [firstItem] = CHECKLIST.items;
    if (!firstItem) throw new Error('expected checklist item fixture');
    const unsubmitted: SubmissionChecklist = {
      ...CHECKLIST,
      items: [{ ...firstItem, submission: null }],
    };
    vi.mocked(getSubmissionChecklist)
      .mockResolvedValueOnce(unsubmitted)
      .mockRejectedValueOnce(new ApiError(problem('CHECKLIST_UNAVAILABLE')));
    await renderReadyPage();

    const initialSubmission = currentViewProps().initialSubmission;
    if (
      !isValidElement<{
        readonly onSubmitted: () => void;
        readonly onCancel: () => void;
      }>(initialSubmission)
    ) {
      throw new Error('expected initial submission element');
    }
    const submissionProps = initialSubmission.props;

    act(() => submissionProps.onSubmitted());
    await flushAsyncWork();
    expect(getSubmissionChecklist).toHaveBeenCalledTimes(1);

    act(() => submissionProps.onCancel());
    await flushAsyncWork();
    renderPage();
    expect(getSubmissionChecklist).toHaveBeenCalledTimes(2);
    expect(currentViewProps().checklist).toEqual(unsubmitted);
    expect(currentViewProps().refreshError).toBe('CHECKLIST_UNAVAILABLE');
  });
  it('POST 201 성공 화면에서 browser Back으로 닫으면 authoritative checklist를 한 번 읽어 SUBMITTED를 표시한다', async () => {
    const [firstItem] = CHECKLIST.items;
    if (!firstItem) throw new Error('expected checklist item fixture');
    const unsubmitted: SubmissionChecklist = {
      ...CHECKLIST,
      items: [{ ...firstItem, submission: null }],
    };
    const submitted: SubmissionChecklist = {
      ...CHECKLIST,
      items: [
        {
          ...firstItem,
          submission: {
            id: 'submission-created',
            status: 'SUBMITTED',
            currentRevision: 1,
            decision: null,
            lastReviewedAt: null,
            reviewComment: null,
            canResubmit: false,
            file: null,
          },
        },
      ],
    };
    vi.mocked(getSubmissionChecklist)
      .mockResolvedValueOnce(unsubmitted)
      .mockResolvedValueOnce(submitted);
    await renderReadyPage();

    const initialSubmission = currentViewProps().initialSubmission;
    if (
      !isValidElement<{
        readonly onSubmitted: () => void;
      }>(initialSubmission)
    ) {
      throw new Error('expected initial submission element');
    }
    act(() => initialSubmission.props.onSubmitted());
    await flushAsyncWork();
    expect(getSubmissionChecklist).toHaveBeenCalledTimes(1);

    selectedMilestoneId = null;
    renderPage();
    await flushAsyncWork();
    renderPage();

    expect(closeSelected).not.toHaveBeenCalled();
    expect(getSubmissionChecklist).toHaveBeenCalledTimes(2);
    expect(currentViewProps().checklist.items[0]?.submission?.status).toBe(
      'SUBMITTED',
    );
  });

  it('pending initial POST가 열린 동안 browser Back으로 선택을 닫아도 201 후 authoritative checklist를 읽어 최신 제출 상태를 표시한다', async () => {
    const [firstItem] = CHECKLIST.items;
    if (!firstItem) throw new Error('expected checklist item fixture');
    const unsubmitted: SubmissionChecklist = {
      ...CHECKLIST,
      items: [{ ...firstItem, submission: null }],
    };
    const submitted: SubmissionChecklist = {
      ...CHECKLIST,
      items: [
        {
          ...firstItem,
          submission: {
            id: 'submission-created',
            status: 'SUBMITTED',
            currentRevision: 1,
            decision: null,
            lastReviewedAt: null,
            reviewComment: null,
            canResubmit: false,
            file: null,
          },
        },
      ],
    };
    vi.mocked(getSubmissionChecklist)
      .mockResolvedValueOnce(unsubmitted)
      .mockResolvedValueOnce(submitted);
    await renderReadyPage();

    const post = submitInitialPost();
    await flushAsyncWork();
    selectedMilestoneId = null;
    renderPage();
    expect(closeSelected).not.toHaveBeenCalled();

    if (initialSubmissionPage.resolvePost === null) {
      throw new Error('expected POST to be pending');
    }
    await act(async () => {
      initialSubmissionPage.resolvePost?.();
      await post;
    });
    await flushAsyncWork();
    renderPage();

    expect(initialSubmissionPage.posts).toBe(1);
    expect(getSubmissionChecklist).toHaveBeenCalledTimes(2);
    expect(currentViewProps().checklist).toEqual(submitted);
    expect(currentViewProps().checklist.items[0]?.submission?.status).toBe(
      'SUBMITTED',
    );
  });

  it('browser Back과 initial POST 201이 같은 작업에서 끝나도 authoritative checklist를 한 번만 읽는다', async () => {
    const [firstItem] = CHECKLIST.items;
    if (!firstItem) throw new Error('expected checklist item fixture');
    const unsubmitted: SubmissionChecklist = {
      ...CHECKLIST,
      items: [{ ...firstItem, submission: null }],
    };
    const submitted: SubmissionChecklist = {
      ...CHECKLIST,
      items: [
        {
          ...firstItem,
          submission: {
            id: 'submission-created',
            status: 'SUBMITTED',
            currentRevision: 1,
            decision: null,
            lastReviewedAt: null,
            reviewComment: null,
            canResubmit: false,
            file: null,
          },
        },
      ],
    };
    vi.mocked(getSubmissionChecklist)
      .mockResolvedValueOnce(unsubmitted)
      .mockResolvedValueOnce(submitted);
    await renderReadyPage();

    const post = submitInitialPost();
    await flushAsyncWork();
    selectedMilestoneId = null;
    if (initialSubmissionPage.resolvePost === null) {
      throw new Error('expected POST to be pending');
    }
    await act(async () => {
      renderPendingSelection();
      initialSubmissionPage.resolvePost?.();
      await post;
    });
    await flushAsyncWork();
    renderPage();

    expect(closeSelected).not.toHaveBeenCalled();
    expect(initialSubmissionPage.posts).toBe(1);
    expect(getSubmissionChecklist).toHaveBeenCalledTimes(2);
    expect(currentViewProps().checklist).toEqual(submitted);
    expect(currentViewProps().checklist.items[0]?.submission?.status).toBe(
      'SUBMITTED',
    );
  });
});

describe('SubmissionChecklistPage 선택 패널 표시', () => {
  it('페이지가 넘긴 문맥 그대로 그리면 마일스톤 이름이나 상태가 반복되지 않는다', async () => {
    await renderReadyPage();
    const props = currentViewProps();
    const item = props.checklist.items[0];
    if (!item) throw new Error('expected checklist item');

    act(() => props.onCloseSelected?.());
    expect(closeSelected).toHaveBeenCalled();
    const html = renderToStaticMarkup(
      <SelectedMilestonePanel
        fileUpload={props.checklist.fileUpload}
        programId={props.programId}
        item={item}
        input={props.input}
        comment={props.comment}
        errors={props.errors}
        fileError={props.fileError}
        submitting={props.submitting}
        submissionPhase={props.submissionPhase}
        onCloseSelected={props.onCloseSelected}
        onTextChange={props.onTextChange}
        onFileChange={props.onFileChange}
        onCommentChange={props.onCommentChange}
        onResubmit={props.onResubmit}
      />,
    );

    expect(html).not.toContain(item.name);
    expect(html).not.toContain('data-slot="card"');
    expect((html.match(/data-slot="status-badge"/g) ?? []).length).toBe(1);

    expect(html).toContain('Replace the file');
    expect((html.match(/현재 제출본/g) ?? []).length).toBe(1);
    expect(html).toContain('제출본 4번 제출');
    expect(html).not.toContain('검토 대기 중');
  });
});

describe('SubmissionChecklistPage 참여자 아님(#1099)', () => {
  it.each([
    ['SUB_003', '해당 신청의 제출 권한이 없습니다.'],
    ['SUB_004', '승인된 신청만 제출할 수 있습니다.'],
  ])('%s 403은 실패가 아니라 참여자 아님 상태로 간다', async (code, detail) => {
    vi.mocked(getSubmissionChecklist).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: code,
        status: 403,
        detail,
        instance: '/synthetic/programs/program-1/submissions/me',
        code,
      }),
    );

    renderPage();
    await flushAsyncWork();
    renderPage();

    expect(fallbackScreens.participationRequired).toBeGreaterThan(0);
    expect(fallbackScreens.participationProgramId).toBe('program-1');
    expect(fallbackScreens.loadFailure).toBe(0);
  });

  it('참여와 무관한 실패는 지금처럼 재시도 가능한 실패 화면으로 남는다', async () => {
    vi.mocked(getSubmissionChecklist).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'SUB_016',
        status: 404,
        detail: '프로그램을 찾을 수 없습니다.',
        instance: '/synthetic/programs/program-1/submissions/me',
        code: 'SUB_016',
      }),
    );

    renderPage();
    await flushAsyncWork();
    renderPage();

    expect(fallbackScreens.loadFailure).toBeGreaterThan(0);
    expect(fallbackScreens.participationRequired).toBe(0);
  });
});
