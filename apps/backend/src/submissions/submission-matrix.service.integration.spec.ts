import {
  AccountStatus,
  ApplicationStatus,
  Role,
  RoleRequestStatus,
  SubmissionStatus,
} from '@prisma/client';
import { runProfile } from '../../prisma/seed';
import {
  prisma as seedPrisma,
  seedGithubId,
  seedId,
  SeedStats,
} from '../../prisma/seeds/helpers';
import { MILESTONE_SCENARIOS } from '../../prisma/seeds/milestones';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { SubmissionMatrixQuery } from './domain/submission-matrix';
import type { MatrixRowResponseDto } from './dto/submission-matrix-response.dto';
import { SubmissionMatrixStore } from './submission-matrix.store';
import { SubmissionMatrixService } from './submission-matrix.service';
import { SubmissionsErrorCode } from './submissions-error-code.enum';

// allow: SIZE_OK — 권한 4종·개인/팀/미제출 행·5개 상태·검색·형태·페이지네이션이 하나의 격리 PostgreSQL lifecycle을 공유한다.
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new SubmissionMatrixService(new SubmissionMatrixStore(prisma));

const PROGRAM_ID = seedId('milestones', 'program');
const PERSONAL_APPLICATION_ID = seedId('milestones', 'application', 'personal');
const TEAM_APPLICATION_ID = seedId('milestones', 'application', 'team');

const STAFF_VIEWER_ID = 'synthetic-matrix-staff';
const ADMIN_VIEWER_ID = 'synthetic-matrix-admin';
const STUDENT_VIEWER_ID = 'synthetic-matrix-student';
const PENDING_STAFF_ID = 'synthetic-matrix-pending-staff';
const DEACTIVATED_STAFF_ID = 'synthetic-matrix-deactivated-staff';
const PENDING_REQUEST_ID = 'synthetic-matrix-pending-request';
const ROWHOLDER_ID = 'synthetic-matrix-rowholder';
const UNSUBMITTED_APPLICATION_ID = 'synthetic-matrix-unsubmitted-application';

/** dueAt ASC(동률 createdAt ASC) 기대 순서 — 시드 offsetDays: -3, +4, +5, +6, +8, +10, +12, +15. */
const EXPECTED_MILESTONE_ORDER = [
  MILESTONE_SCENARIOS['milestones-overdue'][0],
  MILESTONE_SCENARIOS['submission-rejected'][0],
  MILESTONE_SCENARIOS['milestones-upcoming'][0],
  MILESTONE_SCENARIOS['submission-changes-requested'][0],
  MILESTONE_SCENARIOS['submission-approved'][0],
  MILESTONE_SCENARIOS['milestone-with-submission'][0],
  MILESTONE_SCENARIOS['submission-existing'][0],
  MILESTONE_SCENARIOS['milestones-upcoming'][1],
];

function query(
  overrides: Partial<SubmissionMatrixQuery> = {},
): SubmissionMatrixQuery {
  return { q: '', applicationMode: null, page: 1, pageSize: 20, ...overrides };
}

function cellFor(row: MatrixRowResponseDto, milestoneId: string) {
  const cell = row.cells.find(
    (candidate) => candidate.milestoneId === milestoneId,
  );
  if (!cell) throw new Error(`밀스톤 cell 누락: ${milestoneId}`);
  return cell;
}

function rowFor(
  rows: readonly MatrixRowResponseDto[],
  applicationId: string,
): MatrixRowResponseDto {
  const row = rows.find(
    (candidate) => candidate.applicationId === applicationId,
  );
  if (!row) throw new Error(`application 행 누락: ${applicationId}`);
  return row;
}

describe('SubmissionMatrixService integration', () => {
  beforeAll(async () => {
    await Promise.all([prisma.$connect(), seedPrisma.$connect()]);
    await runProfile('milestones', new SeedStats());
    await prisma.user.createMany({
      data: [
        {
          id: STAFF_VIEWER_ID,
          githubId: seedGithubId(STAFF_VIEWER_ID),
          nickname: STAFF_VIEWER_ID,
          role: Role.STAFF,
        },
        {
          id: ADMIN_VIEWER_ID,
          githubId: seedGithubId(ADMIN_VIEWER_ID),
          nickname: ADMIN_VIEWER_ID,
          role: Role.ADMIN,
        },
        {
          id: STUDENT_VIEWER_ID,
          githubId: seedGithubId(STUDENT_VIEWER_ID),
          nickname: STUDENT_VIEWER_ID,
          role: Role.STUDENT,
        },
        {
          id: PENDING_STAFF_ID,
          githubId: seedGithubId(PENDING_STAFF_ID),
          nickname: PENDING_STAFF_ID,
          role: null,
        },
        {
          id: DEACTIVATED_STAFF_ID,
          githubId: seedGithubId(DEACTIVATED_STAFF_ID),
          nickname: DEACTIVATED_STAFF_ID,
          role: Role.STAFF,
          accountStatus: AccountStatus.DEACTIVATED,
        },
        {
          id: ROWHOLDER_ID,
          githubId: seedGithubId(ROWHOLDER_ID),
          nickname: ROWHOLDER_ID,
          name: 'Synthetic Nameholder',
          role: Role.STUDENT,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.roleRequest.upsert({
      where: { id: PENDING_REQUEST_ID },
      update: { status: RoleRequestStatus.PENDING },
      create: {
        id: PENDING_REQUEST_ID,
        userId: PENDING_STAFF_ID,
        status: RoleRequestStatus.PENDING,
      },
    });
    await prisma.application.upsert({
      where: { id: UNSUBMITTED_APPLICATION_ID },
      update: { status: ApplicationStatus.APPROVED },
      create: {
        id: UNSUBMITTED_APPLICATION_ID,
        programId: PROGRAM_ID,
        applicantId: ROWHOLDER_ID,
        answers: { synthetic: true },
        applicationTemplateVersion: 1,
        status: ApplicationStatus.APPROVED,
      },
    });
  });

  afterAll(async () => {
    await prisma.application.deleteMany({
      where: { id: UNSUBMITTED_APPLICATION_ID },
    });
    await prisma.roleRequest.deleteMany({ where: { id: PENDING_REQUEST_ID } });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            STAFF_VIEWER_ID,
            ADMIN_VIEWER_ID,
            STUDENT_VIEWER_ID,
            PENDING_STAFF_ID,
            DEACTIVATED_STAFF_ID,
            ROWHOLDER_ID,
          ],
        },
      },
    });
    await Promise.all([prisma.$disconnect(), seedPrisma.$disconnect()]);
  });

  it('STAFF가 개인·팀·미제출 행을 dueAt ASC 매트릭스로 조회한다', async () => {
    // When
    const matrix = await service.matrix(
      seedGithubId(STAFF_VIEWER_ID),
      PROGRAM_ID,
      query(),
    );

    // Then: milestones는 dueAt ASC — 시드 8개가 기대 순서를 유지한다.
    const dueTimes = matrix.milestones.map((milestone) =>
      new Date(milestone.dueAt).getTime(),
    );
    expect([...dueTimes].sort((a, b) => a - b)).toEqual(dueTimes);
    const seedMilestoneIds = new Set(EXPECTED_MILESTONE_ORDER);
    expect(
      matrix.milestones
        .map((milestone) => milestone.id)
        .filter((id) => seedMilestoneIds.has(id)),
    ).toEqual(EXPECTED_MILESTONE_ORDER);

    // Then: rows는 application createdAt ASC — 제출 0건 행도 빠지지 않는다.
    expect(matrix.rows.map((row) => row.applicationId)).toEqual([
      PERSONAL_APPLICATION_ID,
      TEAM_APPLICATION_ID,
      UNSUBMITTED_APPLICATION_ID,
    ]);
    expect(matrix.total).toBe(3);

    const personal = rowFor(matrix.rows, PERSONAL_APPLICATION_ID);
    const team = rowFor(matrix.rows, TEAM_APPLICATION_ID);
    const unsubmitted = rowFor(matrix.rows, UNSUBMITTED_APPLICATION_ID);

    // 개인 행: name이 없어 nickname으로 대체, 상태 3종 + 미제출.
    expect(personal).toMatchObject({
      applicationMode: 'PERSONAL',
      displayName: 'seed-milestones-user-applicant-personal',
      githubLogins: ['seed-milestones-user-applicant-personal'],
    });
    const approvedSubmissionId = seedId(
      'milestones',
      'submission-approved',
      'submission',
    );
    const approvedCell = cellFor(
      personal,
      MILESTONE_SCENARIOS['submission-approved'][0],
    );
    expect(approvedCell).toMatchObject({
      milestoneId: MILESTONE_SCENARIOS['submission-approved'][0],
      submissionId: approvedSubmissionId,
      revision: 1,
      status: SubmissionStatus.APPROVED,
      reviewUrl: `/staff/programs/${PROGRAM_ID}/submissions/${approvedSubmissionId}/review`,
    });
    expect(approvedCell.submittedAt).toMatch(/T.*Z$/);
    expect(
      cellFor(personal, MILESTONE_SCENARIOS['submission-rejected'][0]).status,
    ).toBe(SubmissionStatus.REJECTED);
    expect(
      cellFor(personal, MILESTONE_SCENARIOS['milestone-with-submission'][0])
        .status,
    ).toBe(SubmissionStatus.SUBMITTED);
    expect(
      cellFor(personal, MILESTONE_SCENARIOS['milestones-upcoming'][0]),
    ).toMatchObject({
      submissionId: null,
      revision: null,
      status: 'NOT_SUBMITTED',
      submittedAt: null,
      reviewUrl: null,
    });
    // 팀의 제출은 개인 행에 결합되지 않는다.
    expect(
      cellFor(personal, MILESTONE_SCENARIOS['submission-existing'][0]).status,
    ).toBe('NOT_SUBMITTED');

    // 팀 행: 팀명 displayName + 팀원 GitHub 핸들 전원.
    expect(team).toMatchObject({
      applicationMode: 'TEAM',
      displayName: 'seed-milestones-team',
      githubLogins: [
        'seed-milestones-user-team-leader',
        'seed-milestones-user-team-member',
      ],
    });
    expect(
      cellFor(team, MILESTONE_SCENARIOS['submission-existing'][0]).status,
    ).toBe(SubmissionStatus.SUBMITTED);
    expect(
      cellFor(team, MILESTONE_SCENARIOS['submission-changes-requested'][0])
        .status,
    ).toBe(SubmissionStatus.CHANGES_REQUESTED);
    expect(
      cellFor(team, MILESTONE_SCENARIOS['submission-approved'][0]).status,
    ).toBe('NOT_SUBMITTED');

    // 제출 0건 행: 모든 cell이 미제출이고 개인형 displayName은 User.name 우선.
    expect(unsubmitted).toMatchObject({
      applicationMode: 'PERSONAL',
      displayName: 'Synthetic Nameholder',
      githubLogins: [ROWHOLDER_ID],
    });
    expect(unsubmitted.cells.length).toBe(matrix.milestones.length);
    expect(
      unsubmitted.cells.every(
        (cell) =>
          cell.status === 'NOT_SUBMITTED' &&
          cell.submissionId === null &&
          cell.reviewUrl === null,
      ),
    ).toBe(true);
  });

  it('ADMIN도 같은 매트릭스를 조회한다', async () => {
    // When
    const matrix = await service.matrix(
      seedGithubId(ADMIN_VIEWER_ID),
      PROGRAM_ID,
      query(),
    );

    // Then
    expect(matrix.total).toBe(3);
    expect(matrix.rows).toHaveLength(3);
  });

  it.each([
    ['학생', STUDENT_VIEWER_ID],
    ['PENDING 교직원(role 미승인)', PENDING_STAFF_ID],
    ['비활성 교직원', DEACTIVATED_STAFF_ID],
  ] as const)('%s 접근은 403 STAFF_ONLY로 차단한다', async (_, userId) => {
    await expect(
      service.matrix(seedGithubId(userId), PROGRAM_ID, query()),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.STAFF_ONLY, status: 403 },
    });
  });

  it('없는 프로그램은 404 PROGRAM_NOT_FOUND', async () => {
    await expect(
      service.matrix(
        seedGithubId(STAFF_VIEWER_ID),
        'synthetic-matrix-missing-program',
        query(),
      ),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.PROGRAM_NOT_FOUND, status: 404 },
    });
  });

  it.each([
    ['신청자 이름', 'nameHOLDER', [UNSUBMITTED_APPLICATION_ID]],
    ['팀명', 'MILESTONES-TEAM', [TEAM_APPLICATION_ID]],
    ['팀원 GitHub 핸들', 'USER-TEAM-MEMBER', [TEAM_APPLICATION_ID]],
    ['신청자 GitHub 핸들', 'APPLICANT-PERSONAL', [PERSONAL_APPLICATION_ID]],
    ['불일치 검색어', 'synthetic-matrix-no-such', []],
  ] as const)(
    '검색은 %s을(를) 대소문자 무시로 필터하고 total도 같은 필터를 쓴다',
    async (_, q, expectedIds) => {
      // When
      const matrix = await service.matrix(
        seedGithubId(STAFF_VIEWER_ID),
        PROGRAM_ID,
        query({ q }),
      );

      // Then
      expect(matrix.rows.map((row) => row.applicationId)).toEqual([
        ...expectedIds,
      ]);
      expect(matrix.total).toBe(expectedIds.length);
    },
  );

  it('형태 필터는 개인형과 팀형을 정확히 나눈다', async () => {
    // When
    const [personalOnly, teamOnly] = await Promise.all([
      service.matrix(
        seedGithubId(STAFF_VIEWER_ID),
        PROGRAM_ID,
        query({ applicationMode: 'PERSONAL' }),
      ),
      service.matrix(
        seedGithubId(STAFF_VIEWER_ID),
        PROGRAM_ID,
        query({ applicationMode: 'TEAM' }),
      ),
    ]);

    // Then
    expect(personalOnly.rows.map((row) => row.applicationId)).toEqual([
      PERSONAL_APPLICATION_ID,
      UNSUBMITTED_APPLICATION_ID,
    ]);
    expect(personalOnly.total).toBe(2);
    expect(teamOnly.rows.map((row) => row.applicationId)).toEqual([
      TEAM_APPLICATION_ID,
    ]);
    expect(teamOnly.total).toBe(1);
  });

  it('페이지네이션은 안정 정렬을 유지하고 total은 페이지와 무관하다', async () => {
    // When
    const [secondPage, beyondPage] = await Promise.all([
      service.matrix(
        seedGithubId(STAFF_VIEWER_ID),
        PROGRAM_ID,
        query({ page: 2, pageSize: 1 }),
      ),
      service.matrix(
        seedGithubId(STAFF_VIEWER_ID),
        PROGRAM_ID,
        query({ page: 9, pageSize: 1 }),
      ),
    ]);

    // Then
    expect(secondPage.rows.map((row) => row.applicationId)).toEqual([
      TEAM_APPLICATION_ID,
    ]);
    expect(secondPage).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    expect(beyondPage.rows).toEqual([]);
    expect(beyondPage.total).toBe(3);
  });
});
