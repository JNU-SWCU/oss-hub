import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../_shell/role-gate', () => ({
  RoleGate: ({
    allow,
    children,
  }: {
    readonly allow: readonly string[];
    readonly children: ReactNode;
  }) => <section data-allow={allow.join(',')}>{children}</section>,
}));

vi.mock('@/features/reviews', () => ({
  SubmissionReviewScreen: ({
    programId,
    submissionId,
  }: {
    readonly programId: string;
    readonly submissionId: string;
  }) => (
    <div data-program-id={programId} data-submission-id={submissionId}>
      submission review
    </div>
  ),
}));

import ProgramSubmissionReviewPage from './page';

describe('ProgramSubmissionReviewPage access contract', () => {
  it('STAFF와 ADMIN만 요청한 submission 검토 화면에 허용한다', async () => {
    const params = Promise.resolve({
      id: 'program-existing',
      submissionId: 'submission-existing',
    });

    const page = await ProgramSubmissionReviewPage({ params });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-allow="staff,admin"');
    expect(html).toContain('data-submission-id="submission-existing"');
    expect(html).toContain('data-program-id="program-existing"');
    expect(html).not.toContain('STUDENT');
  });
});
