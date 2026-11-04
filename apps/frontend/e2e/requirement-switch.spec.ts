import { expect, test } from '@playwright/test';
import type { MilestoneDocumentViewerSubmission } from '../src/features/programs/documents/milestone-document-dto';
import type { CreatedMilestoneDocumentReview } from '../src/features/programs/documents/milestone-document-review-dto';
import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';
test.use({
  deviceScaleFactor: process.env.GUIDE_CAPTURE === '1' ? 2 : 1,
  colorScheme: process.env.QA_THEME === 'dark' ? 'dark' : 'light',
});

const before = process.env.REQUIREMENT_SWITCH_PHASE === 'before';
const programId = 'synthetic-requirements';
const milestoneId = 'synthetic-milestone';
const documentId = 'synthetic-document';
const applicationId = 'synthetic-application';
const dueAt = '2099-12-31T14:59:59.000Z';
const fileUpload = {
  maxBytes: 5242880,
  maxLabel: '5 MB',
  accept: '.pdf,.hwp,.zip',
  formatLabel: 'PDF, HWP, ZIP',
};
const milestone = {
  id: milestoneId,
  name: '활동 결과 제출',
  dueAt,
  dDay: 100,
  deadlineLabel: '진행 중',
  description: null,
  submissionType: 'TEXT',
  submissionItemCount: 1,
  viewerSubmissionStatus: 'NOT_SUBMITTED',
  applicationSubmissionSummary: {
    notSubmitted: 0,
    submitted: 1,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    total: 1,
  },
};

for (const width of [1440, 390]) {
  for (const scenario of [
    'single-review',
    'bulk-review',
    'legacy-review',
    'FILE',
    'TEXT',
    'FILE_OR_TEXT',
    'late-resubmit',
    'team-checklist',
  ] as const) {
    test(`${scenario} requirement switch at ${width}`, async ({
      page,
    }, testInfo) => {
      const browserErrors: string[] = [];
      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (
          scenario === 'team-checklist' &&
          message.text().includes('503') &&
          message.location().url.includes('/teams/synthetic-team/activity')
        )
          return;
        browserErrors.push(message.text());
      });
      const staff =
        scenario === 'single-review' ||
        scenario === 'bulk-review' ||
        scenario === 'legacy-review';
      const submissionType = scenario === 'FILE' ? 'FILE' : 'TEXT';
      const late = scenario === 'late-resubmit';
      const scenarioDueAt = late ? '2026-08-01T00:00:00Z' : dueAt;
      const selectedMilestone = {
        ...milestone,
        submissionType,
        dueAt: scenarioDueAt,
        viewerSubmissionStatus: late ? 'CHANGES_REQUESTED' : 'NOT_SUBMITTED',
      };
      let lastReview: CreatedMilestoneDocumentReview | null = null;
      const mutations: unknown[] = [];
      const program = {
        id: programId,
        name: '합성 제출 프로그램',
        organizer: '합성 운영처',
        trackType: 'EXTRACURRICULAR',
        applicationTemplateKey: 'basic',
        lifecycle: 'PUBLISHED',
        description: '',
        repositoryProvisioningEnabled: false,
        applicationPeriod: { startsAt: '2026-01-01T00:00:00Z', endsAt: dueAt },
        viewer: {
          role: staff ? 'STAFF' : 'STUDENT',
          applicationStatus: staff ? null : 'APPROVED',
        },
        milestones: [selectedMilestone],
      };
      const document = {
        id: documentId,
        milestoneId,
        name: '활동 기록',
        required: true,
        sortOrder: 1,
        submissionType: 'FILE_OR_TEXT',
        graceDueAt: null,
        hasTemplateFile: false,
        templateFileName: null,
        viewerSubmission: {
          submitted: false,
          submittedAt: null,
          revision: null,
          status: null,
          hasCurrentFile: false,
          currentFileName: null,
          review: null,
          history: { hasHistory: false, isComplete: true },
        },
      };
      const legacyRequirement = {
        ...document,
        id: 'synthetic-legacy',
        name: milestone.name,
        submissionType,
      };
      let viewer: MilestoneDocumentViewerSubmission = document.viewerSubmission;
      let legacyViewer: MilestoneDocumentViewerSubmission = late
        ? {
            ...document.viewerSubmission,
            submitted: true,
            submittedAt: '2026-07-31T00:00:00Z',
            revision: 1,
            status: 'CHANGES_REQUESTED',
            review: {
              comment: null,
              reviewedAt: '2026-08-02T00:00:00Z',
              resubmissionDueAt: null,
            },
          }
        : document.viewerSubmission;
      const collection = {
        milestone: { id: milestoneId, programId, name: milestone.name, dueAt },
        documents: [
          {
            id: documentId,
            name: document.name,
            isRequired: true,
            sortOrder: 1,
          },
        ],
        rows: [
          {
            applicationId,
            teamName: '합성 팀',
            applicantName: '합성 학생',
            memberNicknames: ['synthetic-student'],
            deliveryStatus: 'COMPLETE',
            cells: [
              {
                documentId,
                isSubmitted: true,
                status: 'SUBMITTED',
                revision: 1,
                submittedAt: '2026-08-01T00:00:00Z',
                file: null,
                content: { type: 'TEXT', text: '합성 활동 기록입니다.' },
                review: null,
              },
            ],
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
        filterCounts: { all: 1, hasMissing: 0, zeroSubmission: 0 },
        deliveryCounts: {
          missing: 0,
          late: 0,
          complete: 1,
          noRequiredItems: 0,
        },
        documentTotals: [{ documentId, submitted: 1, total: 1 }],
      };
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.clock.setFixedTime(new Date('2026-08-15T00:00:00Z'));
      await installSyntheticAuthority(
        page,
        {
          role: staff ? 'STAFF' : 'STUDENT',
          memberKind: staff ? 'STAFF' : 'STUDENT',
          hasStaffAccess: staff,
          hasAdminAccess: false,
        },
        {
          'GET /api/v1/consents/current': (r) =>
            fulfillJson(r, {
              policyVersion: '2026-11-01',
              requiredItems: [
                {
                  key: 'privacy',
                  label: '개인정보 수집·이용',
                  documentUrl: '/policies/privacy',
                },
              ],
              acceptedPolicyVersion: '2026-11-01',
              consented: true,
              nextUrl: '/dashboard',
            }),
          'GET /api/v1/team-invitations/received': (r) => fulfillJson(r, []),
          'GET /api/v1/submissions/synthetic-submission/review-context': (r) =>
            fulfillJson(r, {
              submissionId: 'synthetic-submission',
              application: {
                id: applicationId,
                applicationMode: 'TEAM',
                displayName: '합성 팀',
              },
              milestone: { id: milestoneId, name: milestone.name },
              currentRevision: {
                number: 1,
                content: { type: 'TEXT', text: '합성 활동 기록입니다.' },
                comment: null,
                submittedAt: '2026-08-01T00:00:00Z',
                files: [],
                review: lastReview,
              },
              history: [],
              repository: null,
            }),
          [`GET /api/v1/programs/${programId}`]: (r) => fulfillJson(r, program),
          [`GET /api/v1/programs/${programId}/viewer`]: (r) =>
            fulfillJson(r, program),
          [`GET /api/v1/programs/${programId}/navigation-milestones`]: (r) =>
            fulfillJson(r, [selectedMilestone]),
          [`GET /api/v1/programs/${programId}/overview`]: (r) =>
            fulfillJson(r, {
              programId,
              name: program.name,
              trackType: program.trackType,
              lifecycle: 'PUBLISHED',
              milestoneCount: 1,
              boardPostCount: 0,
              participantCount: 1,
              teamCount: 1,
              connectedRepositoryCount: 0,
              viewerRole: program.viewer.role,
              viewerDocumentsCompleted: 0,
              viewerDocumentsTotal: 2,
              fullySubmittedParticipantCount: 0,
              remainingMilestones: late
                ? []
                : [{ label: milestone.name, dueAt: scenarioDueAt }],
              milestoneDocuments: [
                { milestoneId, title: milestone.name, completed: 0, total: 2 },
              ],
            }),
          [`GET /api/v1/milestones/${milestoneId}/documents`]: (r) =>
            fulfillJson(r, {
              documents:
                new URL(r.request().url()).searchParams.get('scope') === 'all'
                  ? [
                      { ...legacyRequirement, viewerSubmission: legacyViewer },
                      { ...document, viewerSubmission: viewer },
                    ]
                  : [{ ...document, viewerSubmission: viewer }],
              fileUpload,
            }),
          [`GET /api/v1/milestones/${milestoneId}/documents/collection`]: (r) =>
            fulfillJson(r, {
              ...collection,
              rows: collection.rows.map((row) => ({
                ...row,
                cells: row.cells.map((cell) => ({
                  ...cell,
                  status: lastReview?.decision ?? cell.status,
                  review: lastReview,
                })),
              })),
            }),
          [`GET /api/v1/milestones/${milestoneId}/documents/${documentId}/applications/${applicationId}/history`]:
            (r) =>
              fulfillJson(r, { items: [], nextCursor: null, isComplete: true }),
          'POST /api/v1/milestone-document-files/checks': (r) =>
            fulfillJson(r, null),
          'POST /api/v1/milestone-document-files': (r) =>
            fulfillJson(
              r,
              {
                fileId: 'synthetic-upload',
                fileName: 'synthetic.pdf',
                contentType: 'application/pdf',
                size: 30,
                expiresAt: dueAt,
              },
              201,
            ),
          ...Object.fromEntries(
            [documentId, legacyRequirement.id].map((id) => [
              'GET /api/v1/milestones/' +
                milestoneId +
                '/documents/' +
                id +
                '/history',
              (r: import('@playwright/test').Route) =>
                fulfillJson(r, {
                  items: [],
                  nextCursor: null,
                  isComplete: true,
                }),
            ]),
          ),
          ...Object.fromEntries(
            [documentId, legacyRequirement.id].map((id) => [
              'POST /api/v1/milestones/' +
                milestoneId +
                '/documents/' +
                id +
                '/submissions',
              async (r: import('@playwright/test').Route) => {
                const body: unknown = r.request().postDataJSON();
                mutations.push(body);
                expect(body).toEqual({
                  content: {
                    text: scenario === 'FILE' ? null : '합성 제출 내용',
                    fileId: scenario === 'FILE' ? 'synthetic-upload' : null,
                  },
                  expectedRevision: late ? 1 : 0,
                });
                const previous = id === documentId ? viewer : legacyViewer;
                const next: MilestoneDocumentViewerSubmission = {
                  ...previous,
                  submitted: true,
                  status: 'SUBMITTED',
                  revision: (previous.revision ?? 0) + 1,
                  submittedAt: '2026-08-15T00:00:00Z',
                  submittedLate: late,
                  review: late ? previous.review : null,
                  hasCurrentFile: scenario === 'FILE',
                  currentFileName: scenario === 'FILE' ? 'synthetic.pdf' : null,
                };
                if (id === documentId) viewer = next;
                else legacyViewer = next;
                await fulfillJson(
                  r,
                  {
                    id: 'synthetic-submission',
                    status: 'SUBMITTED',
                    submittedAt: next.submittedAt,
                  },
                  201,
                );
              },
            ]),
          ),
          ...Object.fromEntries(
            [documentId, legacyRequirement.id].map((id) => [
              'POST /api/v1/milestones/' +
                milestoneId +
                '/documents/' +
                id +
                '/applications/' +
                applicationId +
                '/reviews',
              async (r: import('@playwright/test').Route) => {
                const body: unknown = r.request().postDataJSON();
                mutations.push(body);
                expect(body).toEqual({
                  decision: 'CHANGES_REQUESTED',
                  expectedRevision: 1,
                  expectedLatestReviewId: null,
                });
                lastReview = {
                  id: 'synthetic-review',
                  decision: 'CHANGES_REQUESTED',
                  comment: null,
                  reviewedAt: '2026-08-15T00:00:00Z',
                  resubmissionDueAt: null,
                  reviewerNickname: 'synthetic-staff',
                };
                await fulfillJson(r, lastReview, 201);
              },
            ]),
          ),
          ['POST /api/v1/programs/' + programId + '/documents/change-requests']:
            async (r) => {
              const body: unknown = r.request().postDataJSON();
              mutations.push(body);
              expect(body).toEqual({
                scope: 'PROGRAM',
                includeFinalDecisions: false,
                expectedVersion: 'a'.repeat(64),
              });
              await fulfillJson(r, { requestedCount: 1 }, 201);
            },
          ['GET /api/v1/programs/' + programId + '/teams/me']: (r) =>
            fulfillJson(r, {
              membership: 'MEMBER',
              team: {
                id: 'synthetic-team',
                name: '합성 팀',
                memberCount: 2,
                minMembers: 1,
                maxMembers: 3,
                hasApplication: true,
                canInvite: false,
                canRemoveMembers: false,
                canLeave: true,
                isLeader: false,
                members: [
                  {
                    userId: 'synthetic-student',
                    nickname: 'synthetic-member-access',
                    name: '합성 학생',
                    isLeader: false,
                  },
                  {
                    userId: 'synthetic-leader',
                    nickname: 'synthetic-leader',
                    name: '합성 팀장',
                    isLeader: true,
                  },
                ],
              },
            }),
          ['GET /api/v1/programs/' +
          programId +
          '/teams/synthetic-team/activity']: (r) =>
            fulfillJson(
              r,
              {
                type: 'about:blank',
                title: '일시적 오류',
                status: 503,
                code: 'SYNTHETIC',
                detail: '합성 활동 조회 실패',
                instance: '/synthetic',
              },
              503,
            ),
          'GET /api/v1/team-invitations/teams/synthetic-team/sent': (r) =>
            fulfillJson(r, []),
          [`GET /api/v1/programs/${programId}/teams`]: (r) =>
            fulfillJson(r, []),
          [`GET /api/v1/programs/${programId}/activity`]: (r) =>
            fulfillJson(r, [
              {
                applicationId,
                label: '합성 팀',
                commitCount: 0,
                pullRequestCount: 0,
                releaseCount: 0,
                dataAsOf: null,
                lastActivityAt: null,
                collectionStatus: 'NOT_CONNECTED',
                members: [],
                hasIncompleteContributions: false,
              },
            ]),
          ['GET /api/v1/programs/' + programId + '/applications/me']: (r) =>
            fulfillJson(r, {
              status: 'APPROVED',
              application: {
                id: applicationId,
                programId,
                status: 'APPROVED',
                teamId: 'synthetic-team',
                answers: { applicantName: '합성 학생', title: '합성 활동' },
                submittedAt: '2026-08-01T00:00:00Z',
                updatedAt: '2026-08-01T00:00:00Z',
                isRepositoryPublicationPlanned: false,
                rejectionReason: null,
                isManager: false,
                canManage: false,
                canEdit: false,
                canCancel: false,
              },
            }),
          [`GET /api/v1/programs/${programId}/documents/change-requests/targets`]:
            (r) =>
              fulfillJson(r, {
                submitted: 1,
                changesRequested: 0,
                approved: 0,
                rejected: 0,
                version: 'a'.repeat(64),
              }),
          [`GET /api/v1/programs/${programId}/submissions/matrix`]: (r) =>
            fulfillJson(r, {
              milestones: [selectedMilestone],
              rows: [],
              page: 1,
              pageSize: 20,
              total: 0,
            }),
          [`GET /api/v1/programs/${programId}/submissions/me`]: (r) =>
            fulfillJson(r, {
              fileUpload,
              applicationId,
              applicationMode: 'TEAM',
              items: [
                {
                  milestoneId,
                  name: milestone.name,
                  dueAt: scenarioDueAt,
                  submissionType,
                  submission: late
                    ? {
                        id: 'synthetic-submission',
                        status: 'CHANGES_REQUESTED',
                        currentRevision: 1,
                        decision: 'CHANGES_REQUESTED',
                        lastReviewedAt: '2026-08-02T00:00:00Z',
                        reviewComment: null,
                        canResubmit: true,
                        file: null,
                      }
                    : null,
                },
              ],
            }),
          [`GET /api/v1/programs/${programId}/milestones/${milestoneId}/submission-form`]:
            (r) =>
              fulfillJson(r, {
                fileUpload,
                applicationId,
                applicationMode: 'TEAM',
                milestone: { ...selectedMilestone, instructions: null },
                existingSubmission: null,
                canSubmit: true,
                blockedReason: null,
              }),
        },
      );
      if (scenario === 'legacy-review') {
        await page.goto(
          `/programs/${programId}/submissions/synthetic-submission/review`,
        );
        await page.getByRole('radio', { name: /보완 요청/ }).click();
      } else if (scenario === 'single-review') {
        await page.goto(
          `/programs/${programId}/milestones/${milestoneId}/documents`,
        );
        await page.getByRole('button', { name: /검토/ }).first().click();
        await page
          .getByTestId('milestone-document-review-panel')
          .getByRole('button', { name: '보완 요청', exact: true })
          .click();
      } else if (scenario === 'bulk-review') {
        await page.goto(`/programs/${programId}/documents`);
        await page
          .getByRole('button', { name: '보완 요청 보내기', exact: true })
          .click();
      } else if (scenario === 'FILE_OR_TEXT') {
        await page.goto(`/programs/${programId}`);
        await page
          .getByTestId('milestone-document-row')
          .filter({ hasText: document.name })
          .getByRole('button', { name: '올리기', exact: true })
          .click();
      } else {
        if (scenario === 'team-checklist') {
          await page.goto('/programs/' + programId + '/team');
          await page
            .getByTestId('checklist')
            .getByRole('link', { name: /활동 결과 제출/ })
            .click();
          await expect(page).toHaveURL(
            new RegExp('/documents[?]milestoneId=' + milestoneId),
          );
        } else {
          await page.goto(
            '/programs/' + programId + '/documents?milestoneId=' + milestoneId,
          );
        }
        if (!before)
          await page
            .getByTestId('milestone-document-row')
            .filter({ hasText: milestone.name })
            .getByRole('button', {
              name: late ? '수정' : '올리기',
              exact: true,
            })
            .click();
        await expect(
          page.locator('input[type=file], textarea').first(),
        ).toBeVisible();
      }
      const region =
        scenario === 'single-review'
          ? page.getByTestId('milestone-document-review-panel')
          : scenario === 'bulk-review'
            ? page.getByRole('alertdialog')
            : page.locator('form').first();
      await expect(region).toBeVisible();
      if (staff && scenario !== 'legacy-review') {
        await expect(region.locator('input[type=datetime-local]')).toHaveCount(
          before ? 1 : 0,
        );
      }
      await page.addStyleTag({
        content: 'nextjs-portal { display: none !important; }',
      });
      await region.scrollIntoViewIfNeeded();
      await region.screenshot({
        path: testInfo.outputPath(
          `${before ? 'before' : 'after'}-${scenario}-${width}-element.png`,
        ),
      });
      await page.screenshot({
        path: testInfo.outputPath(
          `${before ? 'before' : 'after'}-${scenario}-${width}-page.png`,
        ),
        fullPage: true,
      });
      expect(
        await region.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await region.locator('textarea').last().focus();
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toHaveJSProperty(
        'tagName',
        'BUTTON',
      );
      if (width === 390) {
        await page.locator(':focus').evaluate((el) =>
          el.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: 'instant',
          }),
        );
        expect(
          await page.locator(':focus').evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = window.document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
            return hit !== null && (el === hit || el.contains(hit));
          }),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(
            (before ? 'before' : 'after') +
              '-' +
              scenario +
              '-' +
              width +
              '-controls.png',
          ),
        });
      }

      if (!before) {
        if (scenario === 'bulk-review') {
          await region
            .getByRole('button', { name: '1건 보완 요청 보내기', exact: true })
            .click();
          await expect(
            region.getByText('제출 1건에 보완 요청을 보냈습니다.'),
          ).toBeVisible();
        } else if (staff) {
          await region
            .getByRole('button', { name: '저장', exact: true })
            .click();
          if (scenario === 'single-review') {
            await expect(
              page.getByTestId('milestone-document-review-panel'),
            ).toHaveCount(0);
            await page.getByRole('button', { name: /검토/ }).first().click();
          }
          await expect(
            page
              .getByText('사유 없이 저장되었습니다.', { exact: true })
              .first(),
          ).toBeVisible();
          await page.screenshot({
            path: testInfo.outputPath(
              'after-' + scenario + '-' + width + '-no-reason.png',
            ),
            fullPage: true,
          });
        } else {
          if (scenario === 'FILE') {
            await region.locator('input[type=file]').setInputFiles({
              name: 'synthetic.pdf',
              mimeType: 'application/pdf',
              buffer: Buffer.from('%PDF-1.7\nsynthetic\n%%EOF'),
            });
          } else {
            await region.locator('textarea').first().fill('합성 제출 내용');
          }
          await region
            .getByRole('button', {
              name: late ? '다시 제출' : '제출',
              exact: true,
            })
            .click();
          if (late) {
            const confirmation = page.getByRole('alertdialog');
            await expect(confirmation).toBeVisible();
            await confirmation.screenshot({
              path: testInfo.outputPath(
                'after-confirm-' + width + '-element.png',
              ),
            });
            await confirmation
              .getByRole('button', { name: '제출 확정', exact: true })
              .click();
          }
          await expect(page.locator('form')).toHaveCount(0);
          const row = page.getByTestId('milestone-document-row').filter({
            hasText:
              scenario === 'FILE_OR_TEXT' ? document.name : milestone.name,
          });
          await expect(
            row.getByText('검토 대기', { exact: true }).first(),
          ).toBeVisible();
          if (late)
            await expect(
              row.getByRole('button', { name: '수정', exact: true }),
            ).toBeDisabled();
        }
        expect(mutations).toHaveLength(1);
      }
      expect(browserErrors).toEqual([]);
    });
  }
}
