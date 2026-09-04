import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionFormView } from './components/submission-form-view';
import { selectedFileFromControl } from './components/submission-input';
import {
  SubmissionLoadFailure,
  SubmissionSuccess,
} from './components/submission-page-states';
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
  existingSubmission: null,
  canSubmit: true,
  blockedReason: null,
};

const handlers = {
  onTextChange: vi.fn(),
  onFileChange: vi.fn(),
  onCommentChange: vi.fn(),
  onSubmit: vi.fn(),
};

function render(data: SubmissionFormData, file: File | null = null): string {
  return renderToStaticMarkup(
    <SubmissionFormView
      data={data}
      input={{ file, text: '' }}
      comment=""
      errors={{}}
      serverError={null}
      serverErrorKind="generic"
      submitting={false}
      file={file}
      fileError={null}
      submissionPhase={null}
      onCancel={vi.fn()}
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
    expect(html).not.toContain('<main');
    expect(html).not.toContain('<h1');
    expect(html).toMatch(/<h2[^>]*>제출 내용<\/h2>/);
    expect(html).toContain('최종 보고 내용을 입력하세요.');
    expect(html).toContain('id="submission-text"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('제출하기');
    expect(html).not.toContain('Ticket #115');
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
    expect(html).toContain('PDF, HWP, JPG, PNG, ZIP · 최대 5 MB');
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
    expect(html).not.toContain('lucide-check');
  });

  it('FILE을 선택하면 네이티브 선택값과 React에 전달할 파일이 일치한다', () => {
    // Given
    const file = new File(['report'], 'final-report.pdf', {
      type: 'application/pdf',
    });
    const control = {
      files: { item: () => file },
      value: 'C:\\fakepath\\final-report.pdf',
    };

    // When
    const selected = selectedFileFromControl(control);

    // Then
    expect(selected).toBe(file);
    expect(control.value).toBe('C:\\fakepath\\final-report.pdf');
  });

  it('FILE을 선택하기 전에는 제출 단계를 완료로 표시하지 않는다', () => {
    // Given / When
    const html = render({
      ...baseData,
      milestone: { ...baseData.milestone, submissionType: 'FILE' },
    });

    // Then
    expect(html).not.toContain('lucide-check');
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

  // #354 — "지원하지 않습니다"는 학생이 다음에 무엇을 할지 알려주지 않는다.
  // 막힌 범위(이 마일스톤)와 물어볼 대상(담당 교직원)이 함께 있어야 한다.
  it('파일 제출이 막히면 막힌 범위와 문의 대상을 함께 안내한다', () => {
    // Given
    const blockedData: SubmissionFormData = {
      ...baseData,
      milestone: { ...baseData.milestone, submissionType: 'FILE' },
      canSubmit: false,
      blockedReason: 'FILE_UPLOAD_UNAVAILABLE',
    };

    // When
    const html = render(blockedData);

    // Then
    expect(html).toContain('이 마일스톤에는 현재 파일을 제출할 수 없습니다');
    expect(html).toContain('담당 교직원');
    expect(html).toContain('다른 제출 방법을 문의');
    // 옛 문구는 원인도 문의처도 없이 "지원하지 않습니다"로 끝났다.
    expect(html).not.toContain('파일 제출은 현재 지원하지 않습니다');
  });
});

describe('SubmissionLoading', () => {
  it('모달 로딩은 중첩 main 없이 렌더한다', () => {
    const html = renderToStaticMarkup(<SubmissionLoading />);

    expect(html).toContain('aria-label="제출 정보 불러오는 중"');
    expect(html).not.toContain('<main');
  });

  it('모달 오류와 성공 상태도 중첩 main 없이 렌더한다', () => {
    const failure = renderToStaticMarkup(
      <SubmissionLoadFailure message="다시 시도해 주세요." onRetry={vi.fn()} />,
    );
    const success = renderToStaticMarkup(
      <SubmissionSuccess
        onClose={vi.fn()}
        submission={{
          submissionId: 'submission-1',
          status: 'SUBMITTED',
          submittedAt: '2026-08-03T12:00:00.000Z',
        }}
      />,
    );

    expect(failure).toContain('제출 정보 불러오기 실패');
    expect(success).toContain('제출을 완료했습니다');
    expect(success).toContain('확인');
    expect(failure).not.toContain('<main');
    expect(success).not.toContain('<main');
  });
});
