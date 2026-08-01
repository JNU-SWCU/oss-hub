import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionFormView } from './components/submission-form-view';
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

function render(data: SubmissionFormData): string {
  return renderToStaticMarkup(
    <SubmissionFormView
      programId="program-1"
      data={data}
      input={{ file: null, text: '', releaseUrl: '' }}
      comment=""
      errors={{}}
      serverError={null}
      serverErrorKind="generic"
      submitting={false}
      file={null}
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
    // 제목 위계: 마일스톤 이름이 페이지 제목(h1), "제출 내용"이 섹션 머리(h2).
    // 공용 PageHeader·SectionHeading이 속성을 붙이므로 태그와 글자만 고정한다.
    expect(html).toMatch(/<h1[^>]*>최종 제출<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>제출 내용<\/h2>/);
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
    expect(html).toContain('PDF, HWP, JPG, PNG, ZIP · 최대 50MB');
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
