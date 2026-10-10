import { AffiliationKind, MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { MilestoneDocumentsErrorCode } from './domain/milestone-documents-error-code.enum';
import {
  MilestoneDocumentFlowFixture,
  flowIds,
} from './milestone-document-flow.integration-fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const fixture = new MilestoneDocumentFlowFixture();

function staffSubmit(): Promise<Response> {
  return fixture.request(`${fixture.documentPath()}/submissions`, {
    actor: 'staff',
    method: 'POST',
    json: { content: { text: '교직원이 대신 낸 본문', fileId: null } },
  });
}

describe('마일스톤 서류 제출 — 학생 유형 판정', () => {
  beforeAll(() => fixture.start());
  beforeEach(() => fixture.reset());
  afterAll(() => fixture.stop());

  it('교직원·관리자 권한을 함께 가진 학생 팀원은 자기 팀 서류를 낸다', async () => {
    await fixture.prisma.user.update({
      where: { id: flowIds.student },
      data: { hasStaffAccess: true, hasAdminAccess: true },
    });

    expect((await fixture.submit('여러 권한 학생의 제출')).status).toBe(201);
    await expect(
      fixture.prisma.milestoneDocumentSubmission.findFirst({
        where: { milestoneDocumentId: flowIds.document },
        select: { applicationId: true, submittedById: true },
      }),
    ).resolves.toEqual({
      applicationId: flowIds.application,
      submittedById: flowIds.student,
    });
  });

  it('학생 유형이 아닌 교직원은 STUDENT_ONLY로 거절된다', async () => {
    const response = await staffSubmit();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: MilestoneDocumentsErrorCode.STUDENT_ONLY,
    });
  });

  it('학생 유형인 교직원도 자기가 속하지 않은 팀의 서류는 내지 못한다', async () => {
    await fixture.prisma.userProfile.create({
      data: {
        userId: flowIds.staff,
        name: '합성 여러 권한 학생',
        department: '합성 학과',
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: '합성 학과',
      },
    });

    const response = await staffSubmit();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER,
    });
    await expect(
      fixture.prisma.milestoneDocumentSubmission.count({
        where: { milestoneDocumentId: flowIds.document },
      }),
    ).resolves.toBe(0);
  });
});
