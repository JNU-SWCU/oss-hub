import { expect, test } from '@playwright/test';
import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';

test.use({ deviceScaleFactor: 2 });

const programId = 'synthetic-repository-scope';
const teamId = 'synthetic-repository-team';
const repository = {
  id: 'synthetic-repository',
  url: 'https://github.com/synthetic/project',
  visibility: 'PUBLIC',
  publishEligible: false,
  blockedReasons: [],
};
const scope = {
  teams: 1,
  members: 1,
  invitations: 0,
  submissions: 0,
  submissionEvents: 0,
  detachedRepositories: 1,
  scopeFingerprint: '0123456789abcdef0123456789abcdef',
};

for (const width of [1440, 390]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`team repository deletion ${width} ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme });
      await page.clock.setFixedTime(new Date('2026-08-15T00:00:00Z'));
      const program = {
        id: programId,
        name: '합성 프로그램',
        organizer: '합성 주관',
        trackType: 'EXTRACURRICULAR',
        applicationTemplateKey: 'basic',
        description: '',
        repositoryProvisioningEnabled: true,
        applicationPeriod: {
          startsAt: '2026-01-01T00:00:00Z',
          endsAt: '2026-12-31T00:00:00Z',
        },
        viewer: { role: 'STAFF', applicationStatus: null },
        milestones: [],
      };
      const provisioning = {
        enabled: true,
        jobStatus: 'SUCCEEDED',
        updatedAt: '2026-08-01T00:00:00Z',
        safeErrorClass: null,
      };
      await installSyntheticAuthority(
        page,
        {
          role: 'STAFF',
          memberKind: 'STAFF',
          hasStaffAccess: true,
          hasAdminAccess: false,
        },
        {
          'GET /api/v1/consents/current': (route) =>
            fulfillJson(route, {
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
          [`GET /api/v1/programs/${programId}`]: (route) =>
            fulfillJson(route, program),
          [`GET /api/v1/programs/${programId}/viewer`]: (route) =>
            fulfillJson(route, program),
          [`GET /api/v1/programs/${programId}/overview`]: (route) =>
            fulfillJson(route, {
              programId,
              name: program.name,
              trackType: program.trackType,
              milestoneCount: 0,
              boardPostCount: 0,
              participantCount: 1,
              teamCount: 1,
              connectedRepositoryCount: 1,
              viewerRole: 'STAFF',
              viewerDocumentsCompleted: null,
              viewerDocumentsTotal: null,
              fullySubmittedParticipantCount: 0,
              remainingMilestones: [],
              requirements: [],
            }),
          [`GET /api/v1/programs/${programId}/teams/${teamId}`]: (route) =>
            fulfillJson(route, {
              teamId,
              name: '합성 개발팀',
              memberCount: 1,
              members: [
                {
                  userId: 'synthetic-user',
                  name: '합성 학생',
                  nickname: 'synthetic-student',
                  isLeader: true,
                },
              ],
              application: {
                id: teamId,
                status: 'APPROVED',
                repositoryConnectionMode: 'OWN',
                repository,
                repositoryProvisioning: provisioning,
              },
              repositoryContributions: null,
              deletionScope: scope,
            }),
          [`GET /api/v1/teams/${teamId}`]: (route) =>
            fulfillJson(route, {
              id: teamId,
              programId,
              status: 'APPROVED',
              rejectionReason: null,
              repositoryConnectionMode: 'OWN',
              repositoryProvisioning: provisioning,
              participation: 'TEAM',
              applicant: {
                id: 'synthetic-user',
                name: '합성 학생',
                nickname: 'synthetic-student',
              },
              team: { id: teamId, name: '합성 개발팀', memberCount: 1 },
              repository,
              answers: {
                applicantName: '합성 학생',
                title: '합성 프로젝트',
                summary: '',
              },
              reviewHistory: [],
              submittedAt: '2026-08-01T00:00:00Z',
              updatedAt: '2026-08-01T00:00:00Z',
            }),
          [`GET /api/v1/team-invitations/teams/${teamId}/sent`]: (route) =>
            fulfillJson(route, []),
          [`GET /api/v1/programs/${programId}/teams/${teamId}/activity`]: (
            route,
          ) =>
            fulfillJson(route, {
              teamId,
              repository: { id: repository.id, url: repository.url },
              status: 'NOT_COLLECTED',
              lastSuccessAt: null,
              window: {
                from: '2026-08-01',
                to: '2026-08-14',
                timeZone: 'Asia/Seoul',
              },
              canEditRepositoryUrl: false,
              members: [],
            }),
        },
      );
      await page.goto(`/programs/${programId}/teams/${teamId}`);
      const before = process.env.E2E_CAPTURE_PHASE === 'before';
      const phase = before ? 'before' : 'after';
      await page
        .locator('section')
        .filter({
          has: page.getByRole('heading', { name: '위험 영역', exact: true }),
        })
        .screenshot({
          path: testInfo.outputPath(
            `${phase}-danger-${width}-${colorScheme}.png`,
          ),
        });
      await page.getByRole('button', { name: '팀 삭제', exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(
        before
          ? '팀을 삭제합니다. 이 작업은 되돌릴 수 없습니다.'
          : 'OSS Hub의 저장소 등록 정보 1건과 해당 수집 기록을 삭제합니다.',
      );
      if (before) await expect(dialog).not.toContainText('저장소');
      else
        await expect(dialog).toContainText('GitHub 원본 저장소는 유지됩니다.');
      const diagnostics = await dialog.evaluate((root) => {
        const path: string[] = [];
        for (let node: Element | null = root; node; node = node.parentElement) {
          path.unshift(
            node.tagName.toLowerCase() + (node.id ? `#${node.id}` : ''),
          );
        }
        const summaries = [...root.querySelectorAll('p,h1,h2,h3,li,dd,span')]
          .filter((node) => !node.querySelector('p,h1,h2,h3,li,dd,span'))
          .map((node) => node.textContent?.trim() ?? '')
          .filter((text) => text.length >= 4);
        const duplicates = summaries.filter(
          (text, index) => summaries.indexOf(text) !== index,
        );
        const repeatedNumbers = [
          ...root.querySelectorAll('p,li,caption,figcaption'),
        ]
          .map((node) => node.textContent ?? '')
          .filter((text) => {
            const numbers = text.match(/\d+/g) ?? [];
            return numbers.some(
              (number) =>
                numbers.filter((value) => value === number).length >= 3,
            );
          });
        return {
          selector: '[role="alertdialog"]',
          domPath: path.join(' > '),
          duplicateFacts: duplicates,
          repeatedNumberParagraphs: repeatedNumbers,
          stateChoiceGroups: root.querySelectorAll(
            '[role="group"],[role="tablist"]',
          ).length,
          buttons: [...root.querySelectorAll('button')].map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              name: button.textContent,
              width: rect.width,
              height: rect.height,
            };
          }),
        };
      });
      console.log(
        'QA_DOM',
        JSON.stringify({ width, colorScheme, ...diagnostics }),
      );
      expect(diagnostics.duplicateFacts).toEqual([]);
      expect(diagnostics.repeatedNumberParagraphs).toEqual([]);
      expect(
        diagnostics.buttons.every(
          (button) => button.width >= 44 && button.height >= 44,
        ),
      ).toBe(true);
      await dialog.screenshot({
        path: testInfo.outputPath(
          `${phase}-element-${width}-${colorScheme}.png`,
        ),
      });
      await page.screenshot({
        path: testInfo.outputPath(
          `${phase}-desktop-${width}-${colorScheme}.png`,
        ),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await dialog.getByRole('button', { name: '취소', exact: true }).click();
      await expect(dialog).toBeHidden();
    });
  }
}
