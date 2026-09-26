import { submissionUploadLimit } from '../../../test-support/submission-upload-limit';
// @vitest-environment happy-dom

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
  fileId: 'submission-file-1' as string,
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

/** 학생이 실제로 보는 조립 그대로 — 제출 창 안에 최초 제출 화면이 들어간다. */
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
    await act(async () => root.render(submitScreen()));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('제출 창은 본문만 스크롤하고 마지막 줄은 바닥에 붙여 둔다', () => {
    // Given: 제출 창이 열린 최초 제출 화면.
    const body = document.querySelector<HTMLElement>(
      '[data-testid="submission-dialog-body"]',
    );
    const actions = document.querySelector<HTMLElement>(
      '[data-testid="submission-actions"]',
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    // Then: 스크롤 상자는 본문이고 창 자체는 스크롤하지 않는다.
    expect(dialog?.className).toContain('overflow-hidden');
    expect(body?.className).toContain('overflow-y-auto');
    // Then: 마지막 줄은 그 스크롤 상자 안에 sticky로 붙어 있다.
    expect(body?.contains(actions ?? null)).toBe(true);
    expect(actions?.className).toContain('sticky');
    expect(actions?.className).toContain('bottom-0');
    // Then: 제출 버튼이 그 줄 안에 있다 — 내용이 길어져도 함께 밀려나지 않는다.
    const submit = [...(actions?.querySelectorAll('button') ?? [])].find(
      (candidate) => candidate.textContent?.trim() === '제출하기',
    );
    expect(submit?.getAttribute('type')).toBe('submit');
  });

  it('허용하지 않는 파일이면 문구를 띄우고 그 입력으로 초점을 옮긴다', async () => {
    // Given: 허용 목록에 없는 확장자.
    await act(async () =>
      pickFile(new File(['x'], 'plan.txt', { type: 'text/plain' })),
    );

    // When
    await act(async () => clickSubmit());

    // Then: 요청은 나가지 않고, 이유가 화면에 뜨며, 초점이 파일 입력으로 간다.
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
    await act(async () => pickFile(oversized));
    await act(async () => clickSubmit());
    expect(document.body.textContent).toContain('파일은 5 MB 이하여야 합니다.');
    expect(api.uploads).toBe(0);

    await act(async () =>
      pickFile(new File(['%PDF'], 'valid.pdf', { type: 'application/pdf' })),
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
    // Given: 업로드는 성공했다고 하면서 파일 id가 빈 응답.
    api.fileId = '';
    await act(async () =>
      pickFile(new File(['x'], 'plan.pdf', { type: 'application/pdf' })),
    );

    // When
    await act(async () => clickSubmit());

    // Then: 제출 생성까지 가지 않고, 창은 그대로 두되 막힌 이유를 띄운다.
    expect(api.uploads).toBe(1);
    expect(api.creates).toBe(0);
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(
      (node) => node.textContent,
    );
    expect(
      alerts.some((text) => text?.includes('제출 내용을 만들지 못했습니다')),
    ).toBe(true);
  });

  /*
   * #1108 — 허용 형식인 `.zip`이 압축 안의 내용 때문에 막혔다. 형식 안내를 띄우면 학생은
   * 고칠 곳을 찾지 못하고 같은 파일을 다시 낸다. 서버의 갈래별 문장을 파일 입력 옆에 세운다.
   */
  it('압축 파일 내용 거절은 서버 문장을 파일 입력 옆에 세운다', async () => {
    // Given: 서버가 압축 안에 든 또 다른 압축 파일을 이유로 거절한다.
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
    await act(async () =>
      pickFile(new File(['PK'], 'bundle.zip', { type: 'application/zip' })),
    );

    // When
    await act(async () => clickSubmit());

    // Then: 제출 생성까지 가지 않고, 문장이 파일 입력의 오류 자리에 선다.
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

  /*
   * #1108 인터뷰 — 거절 사유를 보려고 제출을 눌러야 했다. ZIP을 고르기만 해도 판정을
   * 기다리는 동안은 그 자리에 대기를, 거절이면 같은 자리에 서버 문장을 세운다.
   */
  it('ZIP을 고르면 제출을 누르지 않아도 거절 문장이 파일 입력 옆에 선다', async () => {
    // Given: 판정이 아직 돌아오지 않았다.
    const detail =
      '비밀번호가 걸린 압축 파일은 제출할 수 없습니다. 비밀번호 없이 다시 압축해 주세요.';
    let rejectCheck: (reason: unknown) => void = () => undefined;
    const pendingCheck = new Promise<void>((_resolve, reject) => {
      rejectCheck = reject;
    });
    api.checkResult = () => pendingCheck;

    // When: 파일만 고른다.
    await act(async () =>
      pickFile(new File(['PK'], 'locked.zip', { type: 'application/zip' })),
    );

    // Then: 결과가 설 자리에 대기가 보인다.
    const field = document
      .querySelector('#submission-file')
      ?.closest('[data-slot="field"]');
    expect(field?.querySelector('[role="status"]')?.textContent).toBe(
      '파일 확인 중…',
    );

    // When: 서버가 비밀번호를 이유로 거절한다.
    await act(async () =>
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
    );

    // Then: 제출 없이 문장이 파일 입력의 오류 자리에 서고 대기는 사라진다.
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
    // Given: 고른 ZIP이 압축 안의 압축 때문에 거절됐다.
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
    await act(async () =>
      pickFile(new File(['PK'], 'nested.zip', { type: 'application/zip' })),
    );
    expect(document.querySelector('#submission-file-error')?.textContent).toBe(
      detail,
    );

    // When: PDF로 바꾼다.
    await act(async () =>
      pickFile(new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' })),
    );

    // Then: 지난 문장은 사라지고, PDF는 지금처럼 판정을 묻지 않는다.
    expect(document.querySelector('#submission-file-error')).toBeNull();
    expect(api.checks).toBe(1);
  });

  it('올바른 파일이면 업로드와 제출 생성이 이어서 나간다', async () => {
    // Given: 허용 형식의 PDF.
    await act(async () =>
      pickFile(new File(['x'], 'plan.pdf', { type: 'application/pdf' })),
    );

    // When
    await act(async () => clickSubmit());

    // Then
    expect(api.uploads).toBe(1);
    expect(api.creates).toBe(1);
  });
});

describe('SubmissionDialog', () => {
  it('본문 스크롤 상자를 따로 두어 제목이 함께 밀려 올라가지 않는다', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
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
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const header = dialog?.querySelector('header');
    const body = dialog?.querySelector(
      '[data-testid="submission-dialog-body"]',
    );

    expect(body?.contains(header ?? null)).toBe(false);
    expect(body?.textContent).toBe('본문');

    await act(async () => root.unmount());
    container.remove();
  });
});
