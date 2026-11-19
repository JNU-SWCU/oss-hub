import type { Page } from '@playwright/test';
import { CONSENTED_RESPONSE } from './member-access-fixture';
import { authenticatedSessionBody } from './session-mock';

export const mailReviewProgramId = 'mail-review-check';

export async function installMailReviewRoutes(
  page: Page,
  applicantCount = 201,
) {
  await page.clock.setFixedTime(new Date('2026-11-19T00:00:00.000Z'));
  let previewRequests = 0;
  let sendRequests = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/consents/current')
      return route.fulfill({ json: CONSENTED_RESPONSE });
    if (path === '/api/v1/auth/session')
      return route.fulfill({ json: authenticatedSessionBody('staff') });
    if (path === `/api/v1/programs/${mailReviewProgramId}/overview`)
      return route.fulfill({
        json: {
          name: '메일 검토 프로그램',
          boardPostCount: 0,
          participantCount: 201,
          teamCount: 1,
          connectedRepositoryCount: 0,
          viewerRole: 'STAFF',
          viewerDocumentsCompleted: null,
          viewerDocumentsTotal: null,
          fullySubmittedParticipantCount: 0,
          scheduleMilestones: [],
          requirements: [],
        },
      });
    const program = {
      id: mailReviewProgramId,
      name: '메일 검토 프로그램',
      organizers: ['JNU SWCU'],
      trackType: 'EXTRACURRICULAR',
      applicationTemplateKey: 'oss-contest',
      repositoryProvisioningEnabled: false,
      notifyOnDeadline: true,
      description: '메일 화면 검토용 합성 프로그램',
      applicationPeriod: {
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-11-30T23:59:59.000Z',
      },
      viewer: { role: 'STAFF', applicationStatus: null },
      milestones: [],
    };
    if (
      path === `/api/v1/programs/${mailReviewProgramId}/viewer` ||
      path === `/api/v1/programs/${mailReviewProgramId}/edit`
    )
      return route.fulfill({ json: program });
    if (path === `/api/v1/programs/${mailReviewProgramId}`)
      return route.fulfill({
        json: { ...program, viewer: { role: null, applicationStatus: null } },
      });
    if (path === `/api/v1/programs/${mailReviewProgramId}/activity`)
      return route.fulfill({ json: [] });
    if (path === `/api/v1/programs/${mailReviewProgramId}/mail/recipients`)
      return route.fulfill({
        json: {
          programId: mailReviewProgramId,
          programName: '메일 검토 프로그램',
          recipientLimit: 200,
          teams: [
            {
              id: 'team-1',
              name: '합성 팀',
              status: 'APPROVED',
              deadlineEligible: true,
              applicants: Array.from(
                { length: applicantCount },
                (_, index) => ({
                  id: `student-${index}`,
                  displayName: `합성 학생 ${index}`,
                  nickname: `student-${index}`,
                  mailAvailable: true,
                }),
              ),
            },
          ],
        },
      });
    if (path === `/api/v1/programs/${mailReviewProgramId}/mail/preview`) {
      previewRequests += 1;
      return route.fulfill({ status: 500, json: {} });
    }
    if (path === `/api/v1/programs/${mailReviewProgramId}/mail/send`) {
      sendRequests += 1;
      return route.fulfill({ status: 500, json: {} });
    }
    throw new Error(`Unexpected request: ${request.method()} ${path}`);
  });
  return {
    counts: () => ({ previewRequests, sendRequests }),
  };
}
