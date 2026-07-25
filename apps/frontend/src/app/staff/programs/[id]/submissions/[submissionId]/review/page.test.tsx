import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../_shell/role-gate', () => ({
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
    submissionId,
  }: {
    readonly submissionId: string;
  }) => <div data-submission-id={submissionId}>submission review</div>,
}));

import SubmissionReviewPage from './page';

describe('SubmissionReviewPage access contract', () => {
  it('STAFF와 ADMIN만 요청한 submission 검토 화면에 허용한다', async () => {
    // Given
    const params = Promise.resolve({ submissionId: 'submission-existing' });

    // When
    const page = await SubmissionReviewPage({ params });
    const html = renderToStaticMarkup(page);

    // Then
    expect(html).toContain('data-allow="STAFF,ADMIN"');
    expect(html).toContain('data-submission-id="submission-existing"');
    expect(html).not.toContain('STUDENT');
  });
});
