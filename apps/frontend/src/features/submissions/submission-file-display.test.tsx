import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { SubmissionChecklistView } from './components/submission-checklist-view';
import type {
  ChecklistSubmission,
  SubmissionChecklist,
  SubmissionChecklistItem,
} from './types';

const NOW = new Date('2026-07-24T03:00:00Z');
const FILE_DOWNLOAD_URL = apiPath('submission-files/file-current');

function submission(
  overrides: Partial<ChecklistSubmission>,
): ChecklistSubmission {
  return {
    id: 'submission-file',
    status: 'SUBMITTED',
    currentRevision: 1,
    decision: null,
    lastReviewedAt: null,
    reviewComment: null,
    canResubmit: false,
    file: null,
    ...overrides,
  };
}

function item(
  overrides: Partial<SubmissionChecklistItem>,
): SubmissionChecklistItem {
  return {
    milestoneId: 'milestone-file',
    name: 'File milestone',
    dueAt: '2026-07-30T14:59:59.000Z',
    submissionType: 'FILE',
    submission: submission({}),
    ...overrides,
  };
}

function checklist(
  items: readonly SubmissionChecklistItem[],
): SubmissionChecklist {
  return {
    applicationId: 'application-personal',
    applicationMode: 'PERSONAL',
    items,
  };
}

function render(
  input: SubmissionChecklist,
  selectedMilestoneId: string | null,
): string {
  return renderToStaticMarkup(
    <SubmissionChecklistView
      programId="program-1"
      checklist={input}
      selectedMilestoneId={selectedMilestoneId}
      now={NOW}
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
    />,
  );
}

describe('SubmissionChecklistView file display', () => {
  it('does not render a submitted file link when file metadata is absent', () => {
    // Given
    const input = checklist([item({})]);

    // When
    const html = render(input, 'milestone-file');

    // Then
    expect(html).not.toContain('report.pdf');
    expect(html).not.toContain(FILE_DOWNLOAD_URL);
  });

  it('renders the current submitted file name, size, and download link', () => {
    // Given
    const input = checklist([
      item({
        submission: submission({
          file: {
            fileId: 'file-current',
            fileName: 'report.pdf',
            contentType: 'application/pdf',
            size: 1536,
            expiresAt: '2026-08-01T00:00:00.000Z',
            downloadUrl: FILE_DOWNLOAD_URL,
          },
        }),
      }),
    ]);

    // When
    const html = render(input, 'milestone-file');

    // Then
    expect(html).toContain('report.pdf');
    expect(html).toContain('1.5 KB');
    expect(html).toContain(`href="${FILE_DOWNLOAD_URL}"`);
    expect(html).toContain('download="report.pdf"');
  });
});
