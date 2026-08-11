// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
}));

vi.mock('./api', () => ({
  getSubmissionForm: (): Promise<SubmissionFormData> =>
    Promise.resolve(FILE_FORM),
  uploadSubmissionFile: (): Promise<UploadedSubmissionFile> => {
    api.uploads += 1;
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
}));

const FILE_FORM: SubmissionFormData = {
  applicationId: 'application-1',
  applicationMode: 'TEAM',
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
    // Given: 확장자만 pdf이고 형식은 알 수 없는 파일.
    await act(async () =>
      pickFile(new File(['x'], 'plan.pdf', { type: 'application/zip' })),
    );

    // When
    await act(async () => clickSubmit());

    // Then: 요청은 나가지 않고, 이유가 화면에 뜨며, 초점이 파일 입력으로 간다.
    expect(api.uploads).toBe(0);
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(
      (node) => node.textContent,
    );
    expect(alerts).toContain(
      'PDF, HWP, JPG, PNG, ZIP 파일만 제출할 수 있습니다.',
    );
    expect(document.activeElement?.id).toBe('submission-file');
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
