import { expect, test, type Page } from '@playwright/test';

import { CONSENTED_RESPONSE } from './support/member-access-fixture';
import { authenticatedSessionBody } from './support/session-mock';
import type {
  ProgramDetail,
  ProgramMilestone,
} from '../src/features/programs/catalog/dto';
import type { ProgramOverview } from '../src/features/programs/catalog/program-overview-dto';
import type { RequirementList } from '../src/features/programs/documents/requirement-dto';

const programId = 'milestone-timeline-layout';
const DAY_MS = 24 * 60 * 60 * 1000;

const STEPS = [
  {
    id: 'm1',
    name: '팀 구성·주제 확정',
    days: -11,
    items: 1,
    submittedShare: 1,
    description: '팀 이름과 주제를 한 문단으로 정리해 제출하세요.',
  },
  {
    id: 'm2',
    name: '설계 문서',
    days: -4,
    items: 2,
    submittedShare: 5 / 6,
    description: null,
  },
  {
    id: 'm3',
    name: '중간 발표 자료',
    days: 10,
    items: 2,
    submittedShare: 1 / 3,
    description: '발표 자료는 PDF로 제출합니다.',
  },
  {
    id: 'm4',
    name: '최종 보고서',
    days: 24,
    items: 2,
    submittedShare: 0,
    description: null,
  },
  {
    id: 'm5',
    name: '최종 발표회',
    days: 31,
    items: 0,
    submittedShare: 0,
    description: null,
  },
] as const;

function milestonesFor(teams: number): readonly ProgramMilestone[] {
  return STEPS.map((step) => {
    const submitted = Math.floor(teams * step.submittedShare);
    return {
      id: step.id,
      name: step.name,
      dueAt: new Date(Date.now() + step.days * DAY_MS).toISOString(),
      dDay: step.days,
      description: step.description,
      submissionItemCount: step.items,
      viewerSubmissionStatus: null,
      applicationSubmissionSummary:
        step.items === 0
          ? null
          : {
              notSubmitted: teams - submitted,
              submitted,
              approved: 0,
              changesRequested: 0,
              rejected: 0,
              total: teams,
            },
    };
  });
}

function requirementsFor(milestone: ProgramMilestone): RequirementList {
  const summary = milestone.applicationSubmissionSummary;
  return {
    documents: Array.from(
      { length: milestone.submissionItemCount },
      (_, index) => ({
        id: `${milestone.id}-document-${index + 1}`,
        milestoneId: milestone.id,
        name: `${milestone.name} 제출 파일 ${index + 1}`,
        required: index === 0,
        submissionType: 'FILE_OR_TEXT',
        sortOrder: index,
        graceDueAt: null,
        hasTemplateFile: false,
        templateFileName: null,
        teamSubmissionCount: {
          submitted:
            summary === null ? 0 : summary.total - summary.notSubmitted,
          total: summary?.total ?? 0,
        },
      }),
    ),
    fileUpload: {
      maxBytes: 5 * 1024 * 1024,
      maxLabel: '5 MB',
      accept: '.pdf,.hwp,.zip',
      formatLabel: 'PDF, HWP, ZIP',
    },
  };
}

async function installProgramRoutes(
  page: Page,
  milestones: readonly ProgramMilestone[],
  teams: number,
): Promise<void> {
  const program: ProgramDetail = {
    id: programId,
    name: '마일스톤 줄 확인 프로그램',
    organizers: ['JNU SWCU'],
    trackType: 'EXTRACURRICULAR',
    applicationTemplateKey: 'oss-contest',
    repositoryProvisioningEnabled: true,
    description: '마일스톤 진행 타임라인 배치 회귀 테스트',
    applicationPeriod: {
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-31T23:59:59.000Z',
    },
    viewer: { role: 'STAFF', applicationStatus: null },
    milestones: [...milestones],
  };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== 'GET') {
      throw new Error(`Unexpected timeline fixture request: ${method} ${path}`);
    }
    if (path === '/api/v1/consents/current') {
      await route.fulfill({ json: CONSENTED_RESPONSE });
      return;
    }
    if (path === '/api/v1/auth/session') {
      await route.fulfill({ json: authenticatedSessionBody('staff') });
      return;
    }
    if (path === `/api/v1/programs/${programId}/overview`) {
      await route.fulfill({
        json: {
          programId,
          name: program.name,
          trackType: 'EXTRACURRICULAR',
          milestoneCount: milestones.length,
          boardPostCount: 0,
          participantCount: teams,
          teamCount: teams,
          connectedRepositoryCount: 0,
          viewerRole: 'STAFF',
          viewerDocumentsCompleted: null,
          viewerDocumentsTotal: null,
          fullySubmittedParticipantCount: 0,
          scheduleMilestones: [],
          requirements: [],
        } satisfies ProgramOverview,
      });
      return;
    }
    if (path === `/api/v1/programs/${programId}/viewer`) {
      await route.fulfill({ json: program });
      return;
    }
    if (path === `/api/v1/programs/${programId}`) {
      await route.fulfill({
        json: {
          ...program,
          viewer: { role: null, applicationStatus: null },
          milestones: program.milestones.map((milestone) => ({
            ...milestone,
            applicationSubmissionSummary: null,
          })),
        } satisfies ProgramDetail,
      });
      return;
    }
    if (path === `/api/v1/programs/${programId}/activity`) {
      await route.fulfill({ json: [] });
      return;
    }
    const documents = /^\/api\/v1\/milestones\/([^/]+)\/documents$/.exec(path);
    const milestone = milestones.find(({ id }) => id === documents?.[1]);
    if (milestone !== undefined) {
      await route.fulfill({ json: requirementsFor(milestone) });
      return;
    }
    throw new Error(`Unexpected timeline fixture request: ${method} ${path}`);
  });
}

function readRows(page: Page) {
  return page
    .locator('#milestones [data-testid="milestone-row"]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const bands: { top: number; bottom: number }[] = [];
        const range = document.createRange();
        const texts = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        for (
          let node = texts.nextNode();
          node !== null;
          node = texts.nextNode()
        ) {
          if ((node.textContent ?? '').trim() === '') continue;
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width > 0 && rect.height > 0) {
              bands.push({ top: rect.top, bottom: rect.bottom });
            }
          }
        }
        for (const bar of row.querySelectorAll('[role="progressbar"]')) {
          const rect = bar.getBoundingClientRect();
          bands.push({ top: rect.top, bottom: rect.bottom });
        }
        bands.sort((left, right) => left.top - right.top);
        let lines = 0;
        let lineBottom = Number.NEGATIVE_INFINITY;
        for (const band of bands) {
          if ((band.top + band.bottom) / 2 > lineBottom) lines += 1;
          lineBottom = Math.max(lineBottom, band.bottom);
        }

        const name = row.querySelector('[id$="-name"]');
        const time = row.querySelector('time');
        if (name === null || time === null) {
          throw new Error('마일스톤 줄에 이름이나 마감이 없습니다.');
        }
        const nameBox = name.getBoundingClientRect();
        const timeBox = time.getBoundingClientRect();
        const shareLine = (
          element: Element | null | undefined,
          box: DOMRect,
        ): boolean | null => {
          if (element === null || element === undefined) return null;
          const own = element.getBoundingClientRect();
          return own.top < box.bottom && own.bottom > box.top;
        };
        return {
          lines,
          actionOnTitleLine: shareLine(row.querySelector('a'), nameBox),
          deadlineBelowTitle: timeBox.top >= nameBox.bottom - 1,
          stateOnDeadlineLine: shareLine(
            time.closest('p')?.nextElementSibling?.firstElementChild,
            timeBox,
          ),
        };
      }),
    );
}

for (const teams of [6, 128]) {
  test(`390 폭에서 교직원 마일스톤 줄은 팀이 ${teams}곳이어도 두 줄을 넘지 않는다`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    const page = await context.newPage();
    await installProgramRoutes(page, milestonesFor(teams), teams);
    await page.goto(`/programs/${programId}`);
    const section = page.locator('#milestones');
    await expect(
      section.locator('[data-testid="milestone-group"]'),
    ).toHaveCount(STEPS.length);
    await expect(
      section.locator('[data-testid="milestone-document-rows"]:visible'),
    ).toHaveCount(1);
    await section.screenshot({
      path: testInfo.outputPath(`staff-390-${teams}-teams.png`),
    });

    const rows = await readRows(page);

    expect(rows.map((row) => row.lines)).toEqual([2, 2, 2, 2, 2]);
    expect(rows.map((row) => row.actionOnTitleLine)).toEqual([
      true,
      true,
      true,
      true,
      null,
    ]);
    expect(rows.map((row) => row.deadlineBelowTitle)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(rows.map((row) => row.stateOnDeadlineLine)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(
      await section.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await context.close();
  });
}
