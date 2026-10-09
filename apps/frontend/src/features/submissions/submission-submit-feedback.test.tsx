import { submissionUploadLimit } from '../../../test-support/submission-upload-limit';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { SubmissionChecklistView } from './components/submission-checklist-view';
import { SubmissionDialog } from './components/submission-dialog';
import { SubmissionPage } from './submission-page';
import type {
  SubmissionChecklist,
  SubmissionFormData,
  UploadedSubmissionFile,
} from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const api = vi.hoisted(() => ({
  uploads: 0,
  creates: 0,
  fileId: 'submission-file-1',
  uploadFailure: null as Error | null,
  checks: 0,
  checkResult: null as (() => Promise<void>) | null,
}));

vi.mock('./api', () => ({
  getSubmissionForm: (): Promise<SubmissionFormData> =>
    Promise.resolve(FILE_FORM),
  uploadSubmissionFile: (): Promise<UploadedSubmissionFile> => {
    api.uploads += 1;
    if (api.uploadFailure) return Promise.reject(api.uploadFailure);
    return Promise.resolve({
      fileId: api.fileId,
      fileName: 'plan.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresAt: '2027-08-11T00:00:00.000Z',
    });
  },
  createSubmission: () => {
    api.creates += 1;
    return Promise.resolve({
      submissionId: 'submission-1',
      status: 'SUBMITTED',
      submittedAt: '2026-08-11T00:00:00.000Z',
    });
  },
  listMilestoneDocumentCurrentFiles: () => Promise.resolve([]),
  checkSubmissionFile: (): Promise<void> => {
    api.checks += 1;
    return api.checkResult?.() ?? Promise.resolve();
  },
}));

const FILE_FORM: SubmissionFormData = {
  applicationId: 'application-1',
  applicationMode: 'TEAM',
  fileUpload: submissionUploadLimit(),
  milestone: {
    id: 'milestone-1',
    name: '본선 발표 자료',
    dueAt: '2026-08-26T14:59:59.000Z',
    dDay: 14,
    deadlineLabel: 'D-14',
    submissionType: 'FILE',
    instructions: null,
  },
  existingSubmission: null,
  canSubmit: true,
  blockedReason: null,
};

const CHECKLIST: SubmissionChecklist = {
  applicationId: 'application-1',
  applicationMode: 'TEAM',
  fileUpload: submissionUploadLimit(),
  items: [
    {
      milestoneId: 'milestone-1',
      name: '본선 발표 자료',
      dueAt: '2026-08-26T14:59:59.000Z',
      submissionType: 'FILE',
      submission: null,
    },
  ],
};

function submitScreen() {
  return (
    <SubmissionChecklistView
      programId="program-1"
      onCloseSelected={vi.fn()}
      onSelectMilestone={vi.fn()}
      initialSubmission={
        <SubmissionPage
          programId="program-1"
          milestoneId="milestone-1"
          onCancel={vi.fn()}
        />
      }
      checklist={CHECKLIST}
      selectedMilestoneId="milestone-1"
      now={new Date('2026-08-11T03:00:00Z')}
      input={{ file: null, text: '' }}
      comment=""
      errors={{}}
      fileError={null}
      serverError={null}
      staleNotice={null}
      toastMessage={null}
      submitting={false}
      submissionPhase={null}
      onTextChange={vi.fn()}
      onFileChange={vi.fn()}
      onCommentChange={vi.fn()}
      onResubmit={vi.fn()}
    />
  );
}

function pickFile(file: File): void {
  const input = document.querySelector<HTMLInputElement>('#submission-file');
  if (!input) throw new Error('파일 입력이 화면에 없다');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: { item: (index: number) => (index === 0 ? file : null) },
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickSubmit(): void {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === '제출하기',
  );
  if (!button) throw new Error('제출하기 버튼이 화면에 없다');
  button.click();
}

describe('제출 화면이 누른 결과를 사용자에게 돌려준다', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    api.uploads = 0;
    api.creates = 0;
    api.fileId = 'submission-file-1';
    api.uploadFailure = null;
    api.checks = 0;
    api.checkResult = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(() => Promise.resolve(root.render(submitScreen())));
  });

  afterEach(async () => {
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
  });

  it('제출 창은 본문만 스크롤하고 마지막 줄은 바닥에 붙여 둔다', () => {
    const body = document.querySelector<HTMLElement>(
      '[data-testid="submission-dialog-body"]',
    );
    const actions = document.querySelector<HTMLElement>(
      '[data-testid="submission-actions"]',
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    expect(dialog?.className).toContain('overflow-hidden');
    expect(body?.className).toContain('overflow-y-auto');

    expect(body?.contains(actions ?? null)).toBe(true);
    expect(actions?.className).toContain('sticky');
    expect(actions?.className).toContain('bottom-0');

    const submit = [...(actions?.querySelectorAll('button') ?? [])].find(
      (candidate) => candidate.textContent?.trim() === '제출하기',
    );
    expect(submit?.getAttribute('type')).toBe('submit');
  });

  it('허용하지 않는 파일이면 문구를 띄우고 그 입력으로 초점을 옮긴다', async () => {
    await act(() =>
      Promise.resolve(
        pickFile(new File(['x'], 'plan.txt', { type: 'text/plain' })),
      ),
    );

    await act(() => Promise.resolve(clickSubmit()));

    expect(api.uploads).toBe(0);
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(
      (node) => node.textContent,
    );
    expect(alerts).toContain('PDF, HWP, ZIP 파일만 제출할 수 있습니다.');
    expect(document.activeElement?.id).toBe('submission-file');
  });

  it('상한 초과 오류 뒤 정상 파일을 고르면 이전 오류를 지운다', async () => {
    const oversized = new File(
      [new Uint8Array(FILE_FORM.fileUpload.maxBytes + 1)],
      'large.pdf',
      { type: 'application/pdf' },
    );
    await act(() => Promise.resolve(pickFile(oversized)));
    await act(() => Promise.resolve(clickSubmit()));
    expect(document.body.textContent).toContain('파일은 5 MB 이하여야 합니다.');
    expect(api.uploads).toBe(0);

    await act(() =>
      Promise.resolve(
        pickFile(new File(['%PDF'], 'valid.pdf', { type: 'application/pdf' })),
      ),
    );
    expect(document.body.textContent).toContain('valid.pdf');
    expect(document.body.textContent).not.toContain(
      '파일은 5 MB 이하여야 합니다.',
    );
    expect(
      document.querySelector('#submission-file')?.getAttribute('aria-invalid'),
    ).toBe('false');
    expect(api.uploads).toBe(0);
  });

  it('업로드가 파일 id를 돌려주지 않으면 조용히 멈추지 않고 이유를 말한다', async () => {
    api.fileId = '';
    await act(() =>
      Promise.resolve(
        pickFile(new File(['x'], 'plan.pdf', { type: 'application/pdf' })),
      ),
    );

    await act(() => Promise.resolve(clickSubmit()));

    expect(api.uploads).toBe(1);
    expect(api.creates).toBe(0);
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(
      (node) => node.textContent,
    );
    expect(
      alerts.some((text) => text?.includes('제출 내용을 만들지 못했습니다')),
    ).toBe(true);
  });

  it('압축 파일 내용 거절은 서버 문장을 파일 입력 옆에 세운다', async () => {
    const detail =
      '압축 파일 안에 또 다른 압축 파일이 있습니다. 안쪽 압축을 풀고 다시 압축해 주세요.';
    api.uploadFailure = new ApiError({
      type: 'about:blank',
      title: 'SUB_027',
      status: 422,
      detail,
      instance: '/synthetic/submission-files',
      code: 'SUB_027',
    });
    await act(() =>
      Promise.resolve(
        pickFile(new File(['PK'], 'bundle.zip', { type: 'application/zip' })),
      ),
    );

    await act(() => Promise.resolve(clickSubmit()));

    expect(api.uploads).toBe(1);
    expect(api.creates).toBe(0);
    expect(document.querySelector('#submission-file-error')?.textContent).toBe(
      detail,
    );
    expect(
      document.querySelector('#submission-file')?.getAttribute('aria-invalid'),
    ).toBe('true');
    expect(document.body.textContent).not.toContain(
      'PDF, HWP, ZIP 파일만 제출할 수 있습니다.',
    );
  });

  it('ZIP을 고르면 제출을 누르지 않아도 거절 문장이 파일 입력 옆에 선다', async () => {
    const detail =
      '비밀번호가 걸린 압축 파일은 제출할 수 없습니다. 비밀번호 없이 다시 압축해 주세요.';
    let rejectCheck: (reason: unknown) => void = () => undefined;
    const pendingCheck = new Promise<void>((_resolve, reject) => {
      rejectCheck = reject;
    });
    api.checkResult = () => pendingCheck;

    await act(() =>
      Promise.resolve(
        pickFile(new File(['PK'], 'locked.zip', { type: 'application/zip' })),
      ),
    );

    const field = document
      .querySelector('#submission-file')
      ?.closest('[data-slot="field"]');
    expect(field?.querySelector('[role="status"]')?.textContent).toBe(
      '파일 확인 중…',
    );

    await act(() =>
      Promise.resolve(
        rejectCheck(
          new ApiError({
            type: 'about:blank',
            title: 'SUB_028',
            status: 422,
            detail,
            instance: '/synthetic/submission-files/checks',
            code: 'SUB_028',
          }),
        ),
      ),
    );

    expect(document.querySelector('#submission-file-error')?.textContent).toBe(
      detail,
    );
    expect(
      document.querySelector('#submission-file')?.getAttribute('aria-invalid'),
    ).toBe('true');
    expect(field?.querySelector('[role="status"]')).toBeNull();
    expect(api.checks).toBe(1);
    expect(api.uploads).toBe(0);
    expect(api.creates).toBe(0);
  });

  it('다른 파일을 고르면 지난 판정 문장을 지우고, ZIP이 아니면 판정을 묻지 않는다', async () => {
    const detail =
      '압축 파일 안에 또 다른 압축 파일이 있습니다. 안쪽 압축을 풀고 다시 압축해 주세요.';
    api.checkResult = () =>
      Promise.reject(
        new ApiError({
          type: 'about:blank',
          title: 'SUB_027',
          status: 422,
          detail,
          instance: '/synthetic/submission-files/checks',
          code: 'SUB_027',
        }),
      );
    await act(() =>
      Promise.resolve(
        pickFile(new File(['PK'], 'nested.zip', { type: 'application/zip' })),
      ),
    );
    expect(document.querySelector('#submission-file-error')?.textContent).toBe(
      detail,
    );

    await act(() =>
      Promise.resolve(
        pickFile(new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' })),
      ),
    );

    expect(document.querySelector('#submission-file-error')).toBeNull();
    expect(api.checks).toBe(1);
  });

  it('올바른 파일이면 업로드와 제출 생성이 이어서 나간다', async () => {
    await act(() =>
      Promise.resolve(
        pickFile(new File(['x'], 'plan.pdf', { type: 'application/pdf' })),
      ),
    );

    await act(() => Promise.resolve(clickSubmit()));

    expect(api.uploads).toBe(1);
    expect(api.creates).toBe(1);
  });
});

describe('SubmissionDialog', () => {
  it('본문 스크롤 상자를 따로 두어 제목이 함께 밀려 올라가지 않는다', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(() =>
      Promise.resolve(
        root.render(
          <SubmissionDialog
            title="제출 내용"
            description="설명"
            onClose={vi.fn()}
            returnFocusId="submission-trigger"
          >
            <p>본문</p>
          </SubmissionDialog>,
        ),
      ),
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const header = dialog?.querySelector('header');
    const body = dialog?.querySelector(
      '[data-testid="submission-dialog-body"]',
    );

    expect(body?.contains(header ?? null)).toBe(false);
    expect(body?.textContent).toBe('본문');

    await act(() => Promise.resolve(root.unmount()));
    container.remove();
  });
});
