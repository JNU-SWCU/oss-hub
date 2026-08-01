import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionFormView } from './components/submission-form-view';
import { consumeSelectedFile } from './components/submission-input';
import { SubmissionLoading } from './submission-page';
import type { SubmissionFormData } from './types';

const baseData: SubmissionFormData = {
  applicationId: 'application-personal',
  applicationMode: 'PERSONAL',
  milestone: {
    id: 'milestone-text',
    name: '최종 제출',
    dueAt: '2026-09-30T14:59:59.000Z',
    dDay: 69,
    deadlineLabel: 'D-69',
    submissionType: 'TEXT',
    instructions: '최종 보고 내용을 입력하세요.',
  },
  repository: null,
  existingSubmission: null,
  canSubmit: true,
  blockedReason: null,
};

const handlers = {
  onTextChange: vi.fn(),
  onReleaseUrlChange: vi.fn(),
  onFileChange: vi.fn(),
  onCommentChange: vi.fn(),
  onSubmit: vi.fn(),
  onReload: vi.fn(),
};

function render(data: SubmissionFormData, file: File | null = null): string {
  return renderToStaticMarkup(
    <SubmissionFormView
      programId="program-1"
      data={data}
      input={{ file, text: '', releaseUrl: '' }}
      comment=""
      errors={{}}
      serverError={null}
      serverErrorKind="generic"
      submitting={false}
      file={file}
      fileError={null}
      submissionPhase={null}
      {...handlers}
    />,
  );
}

describe('SubmissionFormView', () => {
  it('TEXT 마일스톤은 안내와 여러 줄 제출 입력을 표시한다', () => {
    // Given: 제출 가능한 TEXT 폼.

    // When
    const html = render(baseData);

    // Then
    expect(html).toContain('최종 제출');
    expect(html).toContain('<h1>최종 제출</h1>');
    expect(html).toContain('<h2>제출 내용</h2>');
    expect(html).toContain('D-69');
    expect(html).toContain('최종 보고 내용을 입력하세요.');
    expect(html).toContain('id="submission-text"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('제출하기');
    expect(html).not.toContain('Ticket #115');
  });

  it('연결 저장소가 준비된 경우 릴리스 URL 입력을 표시한다', () => {
    // Given
    const repositoryUrl = 'https://github.com/JNU-SWCU/synthetic-repository';

    // When
    const html = render({
      ...baseData,
      milestone: {
        ...baseData.milestone,
        submissionType: 'REPOSITORY_RELEASE',
      },
      repository: { url: repositoryUrl, status: 'READY' },
    });

    // Then
    expect(html).toContain('id="release-url"');
    expect(html).toContain(`${repositoryUrl}/releases/tag/v1.0.0`);
  });

  it('FILE 마일스톤은 접근 가능한 파일 선택과 제한 안내를 표시한다', () => {
    // Given / When
    const html = render({
      ...baseData,
      milestone: { ...baseData.milestone, submissionType: 'FILE' },
    });

    // Then
    expect(html).toContain('id="submission-file"');
    expect(html).toContain('type="file"');
    expect(html).toContain('aria-required="true"');
    expect(html).not.toContain('type="file" required=""');
    expect(html).toContain('PDF, HWP, JPG, PNG, ZIP · 최대 50MB');
    expect(html).toContain('1. 파일 선택');
    expect(html).toContain('2. 선택 확인');
    expect(html).toContain('3. 제출');
    expect(html).toContain('data-testid="file-submission-steps"');
  });

  it('선택한 FILE의 이름·크기를 확인하고 바꾸거나 취소할 수 있다', () => {
    const file = new File(['report'], 'final-report.pdf', {
      type: 'application/pdf',
    });
    const html = render(
      {
        ...baseData,
        milestone: { ...baseData.milestone, submissionType: 'FILE' },
      },
      file,
    );

    expect(html).toContain('final-report.pdf');
    expect(html).toContain('파일 바꾸기');
    expect(html).toContain('선택 취소');
  });

  it('선택을 취소한 뒤 같은 FILE을 다시 선택할 수 있도록 네이티브 값을 비운다', () => {
    const file = new File(['report'], 'final-report.pdf', {
      type: 'application/pdf',
    });
    const control = {
      files: { item: () => file },
      value: 'C:\\fakepath\\final-report.pdf',
    };

    const firstSelection = consumeSelectedFile(control);
    expect(firstSelection).toBe(file);
    expect(control.value).toBe('');

    control.value = 'C:\\fakepath\\final-report.pdf';
    const repeatedSelection = consumeSelectedFile(control);
    expect(repeatedSelection).toBe(file);
    expect(control.value).toBe('');
  });

  it('기존 제출은 최초 FILE 제출과 무관하게 fail-closed한다', () => {
    // Given
    const existingData: SubmissionFormData = {
      ...baseData,
      milestone: { ...baseData.milestone, submissionType: 'FILE' },
      canSubmit: false,
      blockedReason: 'SUBMISSION_ALREADY_EXISTS',
      existingSubmission: {
        id: 'submission-1',
        status: 'SUBMITTED',
        checklistUrl:
          '/programs/program-1/submissions?milestoneId=milestone-text',
      },
    };

    // When
    const html = render(existingData);

    // Then
    expect(html).not.toContain('type="file"');
    expect(html).toContain('제출 내용 확인');
    expect(html).toContain(
      '/programs/program-1/submissions?milestoneId=milestone-text',
    );
  });
});

describe('SubmissionLoading', () => {
  it('embedded 모달 로딩은 중첩 main 없이 렌더한다', () => {
    const html = renderToStaticMarkup(<SubmissionLoading embedded />);

    expect(html).toContain('aria-label="제출 정보 불러오는 중"');
    expect(html).not.toContain('<main');
  });
});
