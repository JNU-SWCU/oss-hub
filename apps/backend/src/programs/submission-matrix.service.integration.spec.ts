import { MilestoneCompletionService } from './submissions.service';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import {
  ApprovalStatus,
  DepartmentType,
  UserType,
  AccountStatus,
  ApplicationStatus,
  SubmissionStatus,
} from '@prisma/client';
import { RequirementCollectionService } from './requirement-archive.service';
import { SubmissionMatrixRequestDto } from './dto/submission-matrix-request.dto';
import { SubmissionMatrixResponseDto } from './dto/submission-matrix-response.dto';
import { MemberKind } from '../users/user-contract.config';
import { runProfile } from '../../prisma/seed';
import {
  prisma as seedPrisma,
  seedGithubId,
  seedId,
  SeedStats,
} from '../../prisma/seeds/helpers';
import { MILESTONE_SCENARIOS } from '../../prisma/seeds/milestones';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { SubmissionMatrixRepository } from './submissions.repository';
import {
  SubmissionMatrixService,
  type SubmissionMatrixQuery,
  type MatrixRowResult,
} from './submission-matrix.service';
import { SubmissionsErrorCode } from './submissions.error';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new SubmissionMatrixService(
  new SubmissionMatrixRepository(prisma),
  new RequirementCollectionService({} as never),
  new MilestoneCompletionService(),
);

const PROGRAM_ID = seedId('milestones', 'program');
const PERSONAL_TEAM_ID = seedId('milestones', 'application-personal', 'team');
const TEAM_ID = seedId('milestones', 'team');

const STAFF_VIEWER_ID = 'synthetic-matrix-staff';
const ADMIN_VIEWER_ID = 'synthetic-matrix-admin';
const STUDENT_VIEWER_ID = 'synthetic-matrix-student';
const PENDING_STAFF_ID = 'synthetic-matrix-pending-staff';
const DEACTIVATED_STAFF_ID = 'synthetic-matrix-deactivated-staff';
const PENDING_REQUEST_ID = 'synthetic-matrix-pending-request';
const ROWHOLDER_ID = 'synthetic-matrix-rowholder';
const UNSUBMITTED_TEAM_ID = 'synthetic-matrix-unsubmitted-application-team';

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

function cellFor(row: MatrixRowResult, milestoneId: string) {
  const cell = row.cells.find(
    (candidate) => candidate.milestoneId === milestoneId,
  );
  if (!cell) throw new Error(`밀스톤 cell 누락: ${milestoneId}`);
  return cell;
}

function rowFor(
  rows: readonly MatrixRowResult[],
  teamId: string,
): MatrixRowResult {
  const row = rows.find((candidate) => candidate.teamId === teamId);
  if (!row) throw new Error(`application 행 누락: ${teamId}`);
  return row;
}

describe('SubmissionMatrixService integration', () => {
  beforeAll(async () => {
    await Promise.all([prisma.$connect(), seedPrisma.$connect()]);
    await runProfile('milestones', new SeedStats());
    await Promise.all(
      [
        {
          id: STAFF_VIEWER_ID,
          githubId: seedGithubId(STAFF_VIEWER_ID),
          nickname: STAFF_VIEWER_ID,
          type: MemberKind.STAFF,
          approvalStatus: ApprovalStatus.APPROVED,
          name: 'Synthetic staff',
          department: 'Synthetic department',
          profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          departmentType: DepartmentType.DEPARTMENT,
        },
        {
          id: ADMIN_VIEWER_ID,
          githubId: seedGithubId(ADMIN_VIEWER_ID),
          nickname: ADMIN_VIEWER_ID,
          ...{ admin: { create: { origin: 'MIGRATION' as const } } },
        },
        {
          id: STUDENT_VIEWER_ID,
          githubId: seedGithubId(STUDENT_VIEWER_ID),
          nickname: STUDENT_VIEWER_ID,
          type: MemberKind.STUDENT,
          approvalStatus: ApprovalStatus.NOT_REQUIRED,
        },
        {
          id: PENDING_STAFF_ID,
          githubId: seedGithubId(PENDING_STAFF_ID),
          nickname: PENDING_STAFF_ID,
          type: UserType.UNSELECTED,
          approvalStatus: ApprovalStatus.NOT_REQUIRED,
        },
        {
          id: DEACTIVATED_STAFF_ID,
          githubId: seedGithubId(DEACTIVATED_STAFF_ID),
          nickname: DEACTIVATED_STAFF_ID,
          accountStatus: AccountStatus.DEACTIVATED,
          type: MemberKind.STAFF,
          approvalStatus: ApprovalStatus.APPROVED,
          name: 'Synthetic staff',
          department: 'Synthetic department',
          profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          departmentType: DepartmentType.DEPARTMENT,
        },
        {
          id: ROWHOLDER_ID,
          githubId: seedGithubId(ROWHOLDER_ID),
          nickname: ROWHOLDER_ID,
          type: MemberKind.STUDENT,
          approvalStatus: ApprovalStatus.NOT_REQUIRED,
        },
      ].map((data) =>
        prisma.user.upsert({
          where: { id: data.id },
          update: {},
          create: data,
        }),
      ),
    );
    await prisma.user.update({
      where: { id: ROWHOLDER_ID },
      data: {
        name: 'Synthetic Nameholder',
        studentId: '261097',
        department: '합성 학과',
        type: MemberKind.STUDENT,
        departmentType: DepartmentType.DEPARTMENT,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.user.update({
      where: { id: PENDING_STAFF_ID },
      data: {
        type: UserType.STAFF,
        approvalStatus: ApprovalStatus.PENDING,
        approvalRequestId: PENDING_REQUEST_ID,
        approvalRequestedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const unsubmittedTeamId = UNSUBMITTED_TEAM_ID;
    await prisma.team.upsert({
      where: { id: unsubmittedTeamId },
      update: { status: ApplicationStatus.APPROVED },
      create: {
        id: unsubmittedTeamId,
        programId: PROGRAM_ID,
        name: UNSUBMITTED_TEAM_ID,
        leaderId: ROWHOLDER_ID,
        applicantId: ROWHOLDER_ID,
        answers: { title: UNSUBMITTED_TEAM_ID },
        applicationTemplateVersion: 1,
        status: ApplicationStatus.APPROVED,
      },
    });
    await prisma.teamMember.upsert({
      where: {
        teamId_userId: {
          teamId: unsubmittedTeamId,
          userId: ROWHOLDER_ID,
        },
      },
      update: {},
      create: {
        teamId: unsubmittedTeamId,
        programId: PROGRAM_ID,
        userId: ROWHOLDER_ID,
      },
    });
  });

  afterAll(async () => {
    await prisma.teamMember.deleteMany({
      where: { teamId: UNSUBMITTED_TEAM_ID },
    });
    await prisma.team.deleteMany({
      where: { id: UNSUBMITTED_TEAM_ID },
    });
    await prisma.admin.deleteMany({ where: { userId: ADMIN_VIEWER_ID } });
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
    const matrix = await service.matrix(PROGRAM_ID, query());

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

    expect(matrix.rows.map((row) => row.teamId)).toEqual([
      PERSONAL_TEAM_ID,
      TEAM_ID,
      UNSUBMITTED_TEAM_ID,
    ]);
    expect(matrix.total).toBe(3);

    const personal = rowFor(matrix.rows, PERSONAL_TEAM_ID);
    const team = rowFor(matrix.rows, TEAM_ID);
    const unsubmitted = rowFor(matrix.rows, UNSUBMITTED_TEAM_ID);

    expect(personal).toMatchObject({
      applicationMode: 'PERSONAL',
      displayName: '합성 개인 신청자',
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
    });
    expect(approvedCell.submittedAt).toBeInstanceOf(Date);
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
    });

    expect(
      cellFor(personal, MILESTONE_SCENARIOS['submission-existing'][0]).status,
    ).toBe('NOT_SUBMITTED');

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

    expect(unsubmitted).toMatchObject({
      applicationMode: 'PERSONAL',
      displayName: 'Synthetic Nameholder',
      githubLogins: [ROWHOLDER_ID],
    });
    expect(unsubmitted.cells.length).toBe(matrix.milestones.length);
    expect(
      unsubmitted.cells.every(
        (cell) => cell.status === 'NOT_SUBMITTED' && cell.submissionId === null,
      ),
    ).toBe(true);
  });

  it('ADMIN도 같은 매트릭스를 조회한다', async () => {
    const matrix = await service.matrix(PROGRAM_ID, query());

    expect(matrix.total).toBe(3);
    expect(matrix.rows).toHaveLength(3);
  });

  it('없는 프로그램은 404 PROGRAM_NOT_FOUND', async () => {
    await expect(
      service.matrix('synthetic-matrix-missing-program', query()),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.PROGRAM_NOT_FOUND, status: 404 },
    });
  });

  it.each([
    ['신청자 이름', 'nameHOLDER', [UNSUBMITTED_TEAM_ID]],
    ['팀명', 'MILESTONES-TEAM', [TEAM_ID]],
    ['팀원 GitHub 핸들', 'USER-TEAM-MEMBER', [TEAM_ID]],
    ['신청자 GitHub 핸들', 'APPLICANT-PERSONAL', [PERSONAL_TEAM_ID]],
    ['불일치 검색어', 'synthetic-matrix-no-such', []],
  ] as const)(
    '검색은 %s을(를) 대소문자 무시로 필터하고 total도 같은 필터를 쓴다',
    async (_, q, expectedIds) => {
      const matrix = await service.matrix(PROGRAM_ID, query({ q }));

      expect(matrix.rows.map((row) => row.teamId)).toEqual([...expectedIds]);
      expect(matrix.total).toBe(expectedIds.length);
    },
  );

  it('참여 유형 필터는 더 이상 행을 가르지 않는다', async () => {
    const [personalOnly, teamOnly, noFilter] = await Promise.all([
      service.matrix(PROGRAM_ID, query({ applicationMode: 'PERSONAL' })),
      service.matrix(PROGRAM_ID, query({ applicationMode: 'TEAM' })),
      service.matrix(PROGRAM_ID, query({})),
    ]);

    expect(personalOnly.rows.map((row) => row.teamId)).toEqual(
      noFilter.rows.map((row) => row.teamId),
    );
    expect(teamOnly.rows.map((row) => row.teamId)).toEqual(
      noFilter.rows.map((row) => row.teamId),
    );
    expect(personalOnly.total).toBe(noFilter.total);
    expect(teamOnly.total).toBe(noFilter.total);
    expect(noFilter.rows.map((row) => row.teamId)).toEqual([
      PERSONAL_TEAM_ID,
      TEAM_ID,
      UNSUBMITTED_TEAM_ID,
    ]);
  });

  it('페이지네이션은 안정 정렬을 유지하고 total은 페이지와 무관하다', async () => {
    const [secondPage, beyondPage] = await Promise.all([
      service.matrix(PROGRAM_ID, query({ page: 2, pageSize: 1 })),
      service.matrix(PROGRAM_ID, query({ page: 9, pageSize: 1 })),
    ]);

    expect(secondPage.rows.map((row) => row.teamId)).toEqual([TEAM_ID]);
    expect(secondPage).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    expect(beyondPage.rows).toEqual([]);
    expect(beyondPage.total).toBe(3);
  });

  describe('프로그램 전체 서류 상태와 정렬', () => {
    const programId = 'synthetic-matrix-slot-program';
    const teamIdAt = (place: number) =>
      `${programId}-team-${String(place).padStart(2, '0')}`;
    const teamIds = Array.from({ length: 21 }, (_, index) =>
      teamIdAt(index + 1),
    );
    const firstTeamId = teamIdAt(1);
    const secondTeamId = teamIdAt(2);
    const lastTeamId = teamIdAt(21);
    const pendingTeamId = `${programId}-pending`;
    const archivedTeamId = `${programId}-archived`;
    const leaderId = (teamId: string) => `${teamId}-leader`;
    const originalApplicantId = `${lastTeamId}-applicant`;
    const lastMemberId = `${lastTeamId}-member`;
    const planId = `${programId}-plan`;
    const reportId = `${programId}-report`;
    const optionalStageId = `${programId}-optional`;
    const primaryDocId = `${planId}-primary`;
    const secondaryDocId = `${planId}-secondary`;
    const reportDocId = `${reportId}-document`;
    const optionalDocId = `${optionalStageId}-document`;
    const optionalApprovedDocId = `${optionalStageId}-approved-document`;
    const approvedReportSubmissionId = `${lastTeamId}-approved-report`;
    const allTeamIds = [...teamIds, pendingTeamId, archivedTeamId];
    const userIds = [
      ...allTeamIds.map(leaderId),
      originalApplicantId,
      lastMemberId,
    ];
    const at = new Date('2026-07-01T00:00:00Z');
    const statusCounts = {
      NOT_SUBMITTED: 57,
      SUBMITTED: 2,
      CHANGES_REQUESTED: 1,
      REJECTED: 1,
      APPROVED: 4,
    };

    beforeAll(async () => {
      const namedProfiles = new Map([
        [leaderId(firstTeamId), 'Zulu participant'],
        [leaderId(lastTeamId), 'Actual leader'],
        [originalApplicantId, 'Original applicant'],
      ]);
      await prisma.user.createMany({
        data: userIds.map((id) => {
          const name = namedProfiles.get(id);
          return {
            id,
            githubId: seedGithubId(id),
            nickname: id,
            ...(name !== undefined && {
              name,
              type: UserType.STUDENT,
              department: 'Synthetic department',
              departmentType: DepartmentType.DEPARTMENT,
              profileCreatedAt: at,
              profileUpdatedAt: at,
            }),
          };
        }),
      });
      await prisma.program.create({
        data: {
          id: programId,
          name: programId,
          organizers: ['Synthetic matrix fixture'],
          category: 'BASIC',
          trackType: 'CURRICULAR',
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: at,
          applicationEndAt: new Date('2026-07-10T00:00:00Z'),
          startAt: new Date('2026-07-11T00:00:00Z'),
          endAt: new Date('2026-09-30T00:00:00Z'),
          teamMinSize: 1,
          teamMaxSize: 5,
          description: 'Synthetic matrix slots fixture',
        },
      });
      await prisma.team.createMany({
        data: allTeamIds.map((id) => ({
          id,
          programId,
          leaderId: leaderId(id),
          applicantId: id === lastTeamId ? originalApplicantId : leaderId(id),
          name: id === lastTeamId ? 'Alpha team' : `Aardvark stored ${id}`,
          answers: {},
          applicationTemplateVersion: 1,
          status: id === pendingTeamId ? 'SUBMITTED' : 'APPROVED',
          archivedAt: id === archivedTeamId ? at : null,
          createdAt: at,
        })),
      });
      await prisma.teamMember.createMany({
        data: [
          ...allTeamIds.map((teamId) => ({
            teamId,
            programId,
            userId: leaderId(teamId),
          })),
          { teamId: lastTeamId, programId, userId: lastMemberId },
        ],
      });
      await prisma.milestone.createMany({
        data: [planId, reportId, optionalStageId].map((id, index) => ({
          id,
          programId,
          name: id,
          startAt: new Date('2026-07-11T00:00:00Z'),
          dueAt: new Date(Date.UTC(2026, 7, index + 1)),
        })),
      });
      await prisma.requirement.createMany({
        data: (
          [
            [primaryDocId, planId, true],
            [secondaryDocId, planId, true],
            [reportDocId, reportId, true],
            [optionalDocId, optionalStageId, false],
            [optionalApprovedDocId, optionalStageId, false],
          ] as const
        ).map(([id, milestoneId, required], sortOrder) => ({
          id,
          milestoneId,
          name: id,
          required,
          sortOrder,
        })),
      });
      await prisma.submission.createMany({
        data: (
          [
            [firstTeamId, primaryDocId, 'APPROVED'],
            [firstTeamId, optionalDocId, 'CHANGES_REQUESTED'],
            [firstTeamId, optionalApprovedDocId, 'APPROVED'],
            [secondTeamId, primaryDocId, 'SUBMITTED'],
            [secondTeamId, secondaryDocId, 'SUBMITTED'],
            [lastTeamId, primaryDocId, 'REJECTED'],
            [lastTeamId, secondaryDocId, 'APPROVED'],
            [lastTeamId, reportDocId, 'APPROVED'],
            [pendingTeamId, primaryDocId, 'REJECTED'],
            [archivedTeamId, primaryDocId, 'REJECTED'],
          ] as const
        ).map(([teamId, requirementId, status]) => ({
          id:
            requirementId === reportDocId
              ? approvedReportSubmissionId
              : `${teamId}-${requirementId}`,
          teamId,
          requirementId,
          status,
          submittedById: leaderId(teamId),
        })),
      });
    });

    afterAll(async () => {
      await prisma.submission.deleteMany({
        where: { teamId: { in: allTeamIds } },
      });
      await prisma.teamMember.deleteMany({ where: { programId } });
      await prisma.team.deleteMany({ where: { programId } });
      await prisma.requirement.deleteMany({
        where: { milestone: { programId } },
      });
      await prisma.milestone.deleteMany({ where: { programId } });
      await prisma.program.deleteMany({ where: { id: programId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    });

    it('21번째 팀의 반려 서류를 첫 페이지에서 찾고 별도 단계의 승인 서류를 보존한다', async () => {
      const unfiltered = await service.matrix(programId, {});
      expect(unfiltered.rows.map((row) => row.teamId)).toEqual(
        teamIds.slice(0, 20),
      );
      expect(unfiltered).toMatchObject({ total: 21, statusCounts });

      const request = plainToInstance(SubmissionMatrixRequestDto, {
        status: 'REJECTED',
        page: '1',
        pageSize: '20',
      });
      await validateOrReject(request, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      const response = SubmissionMatrixResponseDto.from(
        await service.matrix(programId, request),
      );
      expect(response).toMatchObject({
        page: 1,
        pageSize: 20,
        total: 1,
        statusCounts,
      });
      expect(response.rows).toHaveLength(1);
      expect(response.rows[0]).toMatchObject({
        teamId: lastTeamId,
        leaderName: 'Actual leader',
        displayName: 'Alpha team',
        cells: [
          { milestoneId: planId, status: 'REJECTED', submissionId: null },
          {
            milestoneId: reportId,
            status: 'APPROVED',
            submissionId: approvedReportSubmissionId,
          },
          { milestoneId: optionalStageId, deliveryStatus: 'NO_REQUIRED_ITEMS' },
        ],
      });

      const beyondPage = await service.matrix(programId, {
        status: 'REJECTED',
        page: 2,
      });
      expect(beyondPage).toMatchObject({ rows: [], total: 1, statusCounts });
    });

    it('검색 후 상태별 서류 건수를 세고 선택 서류는 제출된 경우에만 센다', async () => {
      const [search, missing, optional, approved] = await Promise.all([
        service.matrix(programId, { q: '  zULu  ', status: 'REJECTED' }),
        service.matrix(programId, { status: 'NOT_SUBMITTED' }),
        service.matrix(programId, { status: 'CHANGES_REQUESTED' }),
        service.matrix(programId, { status: 'APPROVED' }),
      ]);
      expect(search).toMatchObject({
        rows: [],
        total: 0,
        statusCounts: {
          NOT_SUBMITTED: 2,
          SUBMITTED: 0,
          CHANGES_REQUESTED: 1,
          REJECTED: 0,
          APPROVED: 2,
        },
      });
      expect(missing.rows.map((row) => row.teamId)).toEqual(
        teamIds.slice(0, 20),
      );
      expect(missing).toMatchObject({ total: 20, statusCounts });
      expect(optional.rows.map((row) => row.teamId)).toEqual([firstTeamId]);
      expect(optional.total).toBe(1);
      expect(approved.rows.map((row) => row.teamId)).toEqual([
        firstTeamId,
        lastTeamId,
      ]);
      expect(approved.total).toBe(2);
      expect(cellFor(rowFor(approved.rows, firstTeamId), planId).status).toBe(
        'NOT_SUBMITTED',
      );
    });

    it('표시 이름·승인 단계 수·단계 상태를 페이지 앞에서 정렬하며 동률은 ID로 가른다', async () => {
      const [
        teamAsc,
        teamDesc,
        progress,
        progressTie,
        milestoneAsc,
        milestoneDesc,
      ] = await Promise.all([
        service.matrix(programId, {
          sort: 'team',
          direction: 'asc',
          pageSize: 1,
        }),
        service.matrix(programId, {
          sort: 'team',
          direction: 'desc',
          pageSize: 1,
        }),
        service.matrix(programId, {
          sort: 'progress',
          direction: 'desc',
          pageSize: 1,
        }),
        service.matrix(programId, {
          sort: 'progress',
          direction: 'desc',
          page: 2,
          pageSize: 1,
        }),
        service.matrix(programId, {
          sort: `milestone:${planId}`,
          direction: 'asc',
          pageSize: 1,
        }),
        service.matrix(programId, {
          sort: `milestone:${planId}`,
          direction: 'desc',
          pageSize: 1,
        }),
      ]);
      expect(teamAsc.rows.map((row) => row.teamId)).toEqual([lastTeamId]);
      expect(teamDesc.rows.map((row) => row.teamId)).toEqual([firstTeamId]);
      expect(progress.rows.map((row) => row.teamId)).toEqual([lastTeamId]);
      expect(progressTie.rows.map((row) => row.teamId)).toEqual([firstTeamId]);
      expect(milestoneAsc).toMatchObject({ total: 21, statusCounts });
      expect(milestoneAsc.rows.map((row) => row.teamId)).toEqual([lastTeamId]);
      expect(milestoneDesc.rows[0]).toMatchObject({
        teamId: secondTeamId,
        leaderName: null,
      });
    });

    it.each([
      { status: 'OVERDUE' },
      { direction: 'up' },
      { sort: 'milestone:' },
      { milestoneId: planId },
    ])('지원하지 않는 매트릭스 쿼리를 거절한다: %j', async (invalid) => {
      const request = plainToInstance(SubmissionMatrixRequestDto, invalid);
      await expect(
        validateOrReject(request, {
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      ).rejects.toHaveLength(1);
    });
  });
});
