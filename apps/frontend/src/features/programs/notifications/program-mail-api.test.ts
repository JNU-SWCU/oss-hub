import { expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import {
  getProgramMailRecipients,
  previewProgramMail,
  sendProgramMail,
} from './program-mail-api';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn().mockResolvedValue({}),
}));
const programId = 'a/b ?#';
const route = 'programs/a%2Fb%20%3F%23/mail/';
const draft = { subject: 'Subject', body: 'Body', applicantIds: ['student'] };

it('reads recipients via the encoded GET endpoint', async () => {
  await getProgramMailRecipients(programId);
  expect(apiClient).toHaveBeenLastCalledWith(route + 'recipients');
});

it('posts the draft to preview', async () => {
  await previewProgramMail(programId, draft);
  expect(apiClient).toHaveBeenLastCalledWith(route + 'previews', {
    method: 'POST',
    body: JSON.stringify({ kind: 'PROGRAM', draft }),
  });
});

it('sends only draft and confirmation fields, not rendered preview data', async () => {
  const previewedAt = '2026-11-19T00:00:00.000Z';
  const previewVersion = 'a'.repeat(64);
  await sendProgramMail(programId, {
    ...draft,
    previewedAt,
    previewVersion,
    expiresAt: '2026-11-19T00:10:00.000Z',
    senderName: 'Staff',
    programName: 'Program',
    renderedSubject: '[oss-hub] Subject',
    footer: 'Footer',
    recipientNames: ['Student'],
    recipientCount: 1,
  });
  expect(apiClient).toHaveBeenLastCalledWith(route + 'jobs', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'PROGRAM',
      draft: { ...draft, previewedAt, previewVersion },
    }),
  });
});
