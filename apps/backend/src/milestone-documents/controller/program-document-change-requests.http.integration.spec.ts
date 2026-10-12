import { ReviewDecision, SubmissionStatus } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { MilestoneDocumentsErrorCode } from '../domain/milestone-documents-error-code.enum';
import {
  MilestoneDocumentFlowFixture,
  flowIds,
} from '../repository/milestone-document-flow.integration-fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const fixture = new MilestoneDocumentFlowFixture();

const extra = {
  student: 'qa1562-bulk-student-b',
  team: 'qa1562-bulk-team-b',
  application: 'qa1562-bulk-application-b',
  submission: 'qa1562-bulk-submission-b',
} as const;
const changeRequestsPath = `programs/${flowIds.program}/documents/change-requests`;
const dueAt = '2099-06-30T14:59:59.000Z';

async function clearExtra(): Promise<void> {
  const where = { applicationId: extra.application };
  await fixture.prisma.milestoneDocumentReviewHistory.deleteMany({
    where: { milestoneDocumentSubmission: where },
  });
  await fixture.prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { submission: where },
  });
  await fixture.prisma.milestoneDocumentSubmission.deleteMany({ where });
  await fixture.prisma.application.deleteMany({
    where: { id: extra.application },
  });
  await fixture.prisma.teamMember.deleteMany({ where: { teamId: extra.team } });
  await fixture.prisma.team.deleteMany({ where: { id: extra.team } });
  await fixture.prisma.user.deleteMany({ where: { id: extra.student } });
}

async function seedSecondTeam(): Promise<void> {
  await fixture.prisma.user.create({
    data: {
      id: extra.student,
      githubId: 960000001562002n,
      nickname: extra.student,
    },
  });
  await fixture.prisma.team.create({
    data: {
      id: extra.team,
      programId: flowIds.program,
      name: '합성 팀 나',
      joinCodeDigest: `${extra.team}-digest`,
      leaderId: extra.student,
      members: { create: { userId: extra.student } },
    },
  });
  await fixture.prisma.application.create({
    data: {
      id: extra.application,
      programId: flowIds.program,
      teamId: extra.team,
      applicantId: extra.student,
      status: 'APPROVED',
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
    },
  });
  await fixture.prisma.milestoneDocumentSubmission.create({
    data: {
      id: extra.submission,
      milestoneDocumentId: flowIds.document,
      applicationId: extra.application,
      content: { type: 'TEXT', text: '팀 나 제출' },
      submittedById: extra.student,
      histories: {
        create: {
          event: 'SUBMITTED',
          revision: 1,
          content: { type: 'TEXT', text: '팀 나 제출' },
          actorId: extra.student,
        },
      },
    },
  });
}

function statusOf(applicationId: string) {
  return fixture.prisma.milestoneDocumentSubmission
    .findUniqueOrThrow({
      where: {
        milestoneDocumentId_applicationId: {
          milestoneDocumentId: flowIds.document,
          applicationId,
        },
      },
      select: { status: true },
    })
    .then((submission) => submission.status);
}

function sendChangeRequest(
  body: Record<string, unknown>,
  actor: 'staff' | 'student' = 'staff',
): Promise<Response> {
  return fixture.request(changeRequestsPath, {
    actor,
    method: 'POST',
    json: {
      scope: 'PROGRAM',
      includeFinalDecisions: false,
      comment: '양식을 바꿔 다시 내 주세요.',
      resubmissionDueAt: dueAt,
      ...body,
    },
  });
}

async function previewVersion(query = 'scope=PROGRAM'): Promise<string> {
  const response = await fixture.request(
    `${changeRequestsPath}/targets?${query}`,
    {
      actor: 'staff',
    },
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { readonly version: string }).version;
}

async function approveSecondTeam(): Promise<void> {
  const response = await fixture.request(
    `${fixture.documentPath()}/applications/${extra.application}/reviews`,
    {
      actor: 'staff',
      method: 'POST',
      json: {
        decision: ReviewDecision.APPROVED,
        expectedRevision: 1,
        expectedLatestReviewId: null,
      },
    },
  );
  expect(response.status).toBe(201);
}

describe('#1562 서류 현황 일괄 보완 요청 — HTTP + PostgreSQL', () => {
  beforeAll(() => fixture.start());
  beforeEach(async () => {
    await clearExtra();
    await fixture.reset();
    await seedSecondTeam();
    expect((await fixture.submit('팀 가 제출')).status).toBe(201);
  });
  afterAll(async () => {
    await clearExtra();
    await fixture.stop();
  });

  it('대상 건수를 상태별로 보여 준다', async () => {
    await approveSecondTeam();

    const response = await fixture.request(
      `${changeRequestsPath}/targets?scope=PROGRAM`,
      { actor: 'staff' },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly version: string };
    expect(body).toEqual({
      submitted: 1,
      changesRequested: 0,
      approved: 1,
      rejected: 0,
      version: body.version,
    });
    expect(body.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('승인된 신청이 없는 팀은 거절하지 않고 0건으로 센다', async () => {
    await fixture.prisma.application.update({
      where: { id: extra.application },
      data: { status: 'SUBMITTED' },
    });

    const response = await fixture.request(
      `${changeRequestsPath}/targets?scope=TEAM&teamId=${extra.team}`,
      { actor: 'staff' },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      submitted: 0,
      changesRequested: 0,
      approved: 0,
      rejected: 0,
    });
  });

  it('끝난 판정은 기본으로 그대로 두고 나머지 제출에만 보완 요청 이력을 더한다', async () => {
    await approveSecondTeam();

    const response = await sendChangeRequest({
      expectedVersion: await previewVersion(),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ requestedCount: 1 });
    await expect(statusOf(flowIds.application)).resolves.toBe(
      SubmissionStatus.CHANGES_REQUESTED,
    );
    await expect(statusOf(extra.application)).resolves.toBe(
      SubmissionStatus.APPROVED,
    );
    const review =
      await fixture.prisma.milestoneDocumentReviewHistory.findFirstOrThrow({
        where: {
          milestoneDocumentSubmission: { applicationId: flowIds.application },
        },
        select: { decision: true, comment: true, resubmissionDueAt: true },
      });
    expect(review).toEqual({
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '양식을 바꿔 다시 내 주세요.',
      resubmissionDueAt: new Date(dueAt),
    });
    await expect(
      fixture.prisma.milestoneDocumentSubmissionHistory.count({
        where: { submission: { applicationId: flowIds.application } },
      }),
    ).resolves.toBe(2);
    await expect(
      fixture.prisma.milestoneDocumentSubmission.count({
        where: { milestoneDocumentId: flowIds.document },
      }),
    ).resolves.toBe(2);
  });

  it('이미 승인·반려한 제출도 포함하면 승인된 제출도 보완 요청으로 바꾼다', async () => {
    await approveSecondTeam();

    const response = await sendChangeRequest({
      includeFinalDecisions: true,
      expectedVersion: await previewVersion(),
    });

    expect(response.status).toBe(201);
    await expect(statusOf(extra.application)).resolves.toBe(
      SubmissionStatus.CHANGES_REQUESTED,
    );
  });

  it('팀 범위는 그 팀의 제출만 바꾼다', async () => {
    const response = await sendChangeRequest({
      scope: 'TEAM',
      teamId: extra.team,
      expectedVersion: await previewVersion(`scope=TEAM&teamId=${extra.team}`),
    });

    expect(response.status).toBe(201);
    await expect(statusOf(extra.application)).resolves.toBe(
      SubmissionStatus.CHANGES_REQUESTED,
    );
    await expect(statusOf(flowIds.application)).resolves.toBe(
      SubmissionStatus.SUBMITTED,
    );
  });

  it('미리 본 뒤 판정이 바뀌어 대상이 달라지면 아무것도 바꾸지 않는다', async () => {
    const previewed = await previewVersion();
    await approveSecondTeam();

    const response = await sendChangeRequest({ expectedVersion: previewed });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED,
    });
    await expect(statusOf(flowIds.application)).resolves.toBe(
      SubmissionStatus.SUBMITTED,
    );
    await expect(statusOf(extra.application)).resolves.toBe(
      SubmissionStatus.APPROVED,
    );
    await expect(
      fixture.prisma.milestoneDocumentReviewHistory.count({
        where: {
          decision: ReviewDecision.CHANGES_REQUESTED,
          milestoneDocumentSubmission: {
            milestoneDocumentId: flowIds.document,
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it('학생은 대상 건수도 보내기도 할 수 없다', async () => {
    const targets = await fixture.request(
      `${changeRequestsPath}/targets?scope=PROGRAM`,
      { actor: 'student' },
    );
    const send = await sendChangeRequest(
      { expectedVersion: '0'.repeat(64) },
      'student',
    );

    expect(targets.status).toBe(403);
    expect(send.status).toBe(403);
    expect(await send.json()).toMatchObject({
      code: MilestoneDocumentsErrorCode.STAFF_ONLY,
    });
    await expect(statusOf(flowIds.application)).resolves.toBe(
      SubmissionStatus.SUBMITTED,
    );
  });

  it('서류 현황 칸에 보완 요청 중인 서류 수가 보인다', async () => {
    expect(
      (await sendChangeRequest({ expectedVersion: await previewVersion() }))
        .status,
    ).toBe(201);

    const response = await fixture.request(
      `programs/${flowIds.program}/submissions/matrix?page=1&pageSize=20`,
      { actor: 'staff' },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly rows: readonly {
        readonly applicationId: string;
        readonly cells: readonly { readonly changesRequestedCount: number }[];
      }[];
    };
    expect(
      body.rows.map((row) => [
        row.applicationId,
        row.cells.map((cell) => cell.changesRequestedCount),
      ]),
    ).toEqual(
      expect.arrayContaining([
        [flowIds.application, [1]],
        [extra.application, [1]],
      ]),
    );
  });
});
