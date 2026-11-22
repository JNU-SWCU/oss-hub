import { MilestoneCompletionService } from './submissions.service';
import { RequirementCollectionService } from './requirement-archive.service';
import type {
  MatrixApplicationPage,
  MatrixDocumentChangeRequest,
  MatrixMilestoneRecord,
  MatrixSubmissionRecord,
  SubmissionMatrixRepositoryPort,
  SubmissionMatrixFilter,
} from './submissions.repository';
import { SubmissionStatus } from '@prisma/client';
import {
  SubmissionMatrixService,
  type SubmissionMatrixQuery,
} from './submission-matrix.service';
import { SubmissionsErrorCode } from './submissions.error';

const PROGRAM_ID = 'synthetic-matrix-program';
const EMPTY_PAGE: MatrixApplicationPage = {
  items: [],
  total: 0,
  statusCounts: {
    NOT_SUBMITTED: 0,
    SUBMITTED: 0,
    CHANGES_REQUESTED: 0,
    REJECTED: 0,
    APPROVED: 0,
  },
};

interface FakeFixtures {
  readonly milestones?: readonly MatrixMilestoneRecord[];
  readonly page?: MatrixApplicationPage;
  readonly submissions?: readonly MatrixSubmissionRecord[];
  readonly firstSubmissions?: readonly {
    readonly teamId: string;
    readonly requirementId: string;
    readonly firstSubmittedAt: Date;
  }[];
  readonly changeRequests?: readonly MatrixDocumentChangeRequest[];
}

class FakeSubmissionMatrixRepository implements SubmissionMatrixRepositoryPort {
  readonly pageCalls: Array<
    SubmissionMatrixFilter & {
      programId: string;
      skip: number;
      take: number;
    }
  > = [];
  readonly submissionCalls: Array<{
    programId: string;
    teamIds: readonly string[];
  }> = [];

  constructor(private readonly fixtures: FakeFixtures = {}) {}

  programExists(programId: string) {
    return Promise.resolve(programId === PROGRAM_ID);
  }

  findMilestones() {
    return Promise.resolve(this.fixtures.milestones ?? []);
  }

  findApprovedApplications(
    programId: string,
    filter: SubmissionMatrixFilter,
    skip: number,
    take: number,
  ) {
    this.pageCalls.push({ programId, ...filter, skip, take });
    return Promise.resolve(this.fixtures.page ?? EMPTY_PAGE);
  }

  findCurrentSubmissions(teamIds: readonly string[], programId: string) {
    this.submissionCalls.push({ programId, teamIds });
    return Promise.resolve(this.fixtures.submissions ?? []);
  }
  findDocumentFirstSubmissions() {
    return Promise.resolve(this.fixtures.firstSubmissions ?? []);
  }
  findDocumentChangeRequests() {
    return Promise.resolve(this.fixtures.changeRequests ?? []);
  }
}

function query(
  overrides: Partial<SubmissionMatrixQuery> = {},
): SubmissionMatrixQuery {
  return { q: '', applicationMode: null, page: 1, pageSize: 20, ...overrides };
}

describe('SubmissionMatrixService', () => {
  it('프로그램이 없으면 404 PROGRAM_NOT_FOUND', async () => {
    const repository = new FakeSubmissionMatrixRepository();
    const service = new SubmissionMatrixService(
      repository,
      new RequirementCollectionService({} as never),
      new MilestoneCompletionService(),
    );

    await expect(
      service.matrix('missing-program', query()),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.PROGRAM_NOT_FOUND, status: 404 },
    });
    expect(repository.pageCalls).toHaveLength(0);
  });

  it('제출 셀은 현재 revision·제출 시각, 미제출 셀은 NOT_SUBMITTED null들로 결합하고 칸마다 보완 요청 중인 서류 수를 센다', async () => {
    const submittedAt = new Date('2026-08-19T01:00:00.000Z');
    const statusCounts = {
      NOT_SUBMITTED: 3,
      SUBMITTED: 0,
      CHANGES_REQUESTED: 3,
      REJECTED: 0,
      APPROVED: 0,
    };
    const repository = new FakeSubmissionMatrixRepository({
      milestones: [
        {
          id: 'milestone-1',
          name: '기획서',
          dueAt: new Date('2026-08-20T00:00:00.000Z'),
          requiredDocumentIds: ['required-1'],
        },
        {
          id: 'milestone-2',
          name: '최종 제출',
          dueAt: new Date('2026-09-20T00:00:00.000Z'),
          requiredDocumentIds: ['required-2'],
        },
      ],
      page: {
        items: [
          {
            id: 'application-personal',
            leaderName: '합성 신청자',
            applicant: { name: '합성 신청자', nickname: 'synthetic-hong' },
            team: null,
          },
          {
            id: 'application-team',
            leaderName: '합성 팀장',
            applicant: { name: '원래 신청자', nickname: 'synthetic-applicant' },
            team: {
              name: '합성 오픈소스팀',
              memberNicknames: ['synthetic-leader', 'synthetic-member'],
            },
          },
        ],
        total: 2,
        statusCounts,
      },
      submissions: [
        {
          id: 'submission-1',
          requirementId: 'required-1',
          teamId: 'application-personal',
          milestoneId: 'milestone-1',
          status: SubmissionStatus.CHANGES_REQUESTED,
          currentRevision: 2,
          submittedAt,
        },
      ],
      firstSubmissions: [
        {
          teamId: 'application-personal',
          requirementId: 'required-1',
          firstSubmittedAt: new Date('2026-08-18T01:00:00Z'),
        },
      ],
      changeRequests: [
        { teamId: 'application-personal', milestoneId: 'milestone-1' },
        { teamId: 'application-team', milestoneId: 'milestone-2' },
        { teamId: 'application-team', milestoneId: 'milestone-2' },
      ],
    });
    const service = new SubmissionMatrixService(
      repository,
      new RequirementCollectionService({} as never),
      new MilestoneCompletionService(),
    );

    const matrix = await service.matrix(PROGRAM_ID, query());

    expect(repository.submissionCalls).toEqual([
      {
        programId: PROGRAM_ID,
        teamIds: ['application-personal', 'application-team'],
      },
    ]);
    expect(matrix).toEqual({
      milestones: [
        {
          id: 'milestone-1',
          name: '기획서',
          dueAt: new Date('2026-08-20T00:00:00.000Z'),
        },
        {
          id: 'milestone-2',
          name: '최종 제출',
          dueAt: new Date('2026-09-20T00:00:00.000Z'),
        },
      ],
      rows: [
        {
          teamId: 'application-personal',
          applicationMode: 'PERSONAL',
          displayName: '합성 신청자',
          leaderName: '합성 신청자',
          githubLogins: ['synthetic-hong'],
          cells: [
            {
              milestoneId: 'milestone-1',
              submissionId: 'submission-1',
              revision: 2,
              status: SubmissionStatus.CHANGES_REQUESTED,
              submittedAt,
              deliveryStatus: 'COMPLETE',
              changesRequestedCount: 1,
            },
            {
              milestoneId: 'milestone-2',
              submissionId: null,
              revision: null,
              status: 'NOT_SUBMITTED',
              submittedAt: null,
              deliveryStatus: 'MISSING',
              changesRequestedCount: 0,
            },
          ],
        },
        {
          teamId: 'application-team',
          applicationMode: 'TEAM',
          displayName: '합성 오픈소스팀',
          leaderName: '합성 팀장',
          githubLogins: ['synthetic-leader', 'synthetic-member'],
          cells: [
            {
              milestoneId: 'milestone-1',
              submissionId: null,
              revision: null,
              status: 'NOT_SUBMITTED',
              submittedAt: null,
              deliveryStatus: 'MISSING',
              changesRequestedCount: 0,
            },
            {
              milestoneId: 'milestone-2',
              submissionId: null,
              revision: null,
              status: 'NOT_SUBMITTED',
              submittedAt: null,
              deliveryStatus: 'MISSING',
              changesRequestedCount: 2,
            },
          ],
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
      statusCounts,
    });
  });

  it('개인형 displayName은 User.name이 없으면 nickname으로 대체한다', async () => {
    const repository = new FakeSubmissionMatrixRepository({
      page: {
        ...EMPTY_PAGE,
        items: [
          {
            id: 'application-personal',
            leaderName: null,
            applicant: { name: null, nickname: 'synthetic-nameless' },
            team: null,
          },
        ],
        total: 1,
      },
    });
    const service = new SubmissionMatrixService(
      repository,
      new RequirementCollectionService({} as never),
      new MilestoneCompletionService(),
    );

    const matrix = await service.matrix(PROGRAM_ID, query());

    expect(matrix.rows[0]).toMatchObject({
      displayName: 'synthetic-nameless',
      leaderName: null,
      githubLogins: ['synthetic-nameless'],
      cells: [],
    });
  });

  it('검색·상태·정렬과 페이지 범위를 전달하고 빈 페이지에서도 total과 상태 건수를 돌려준다', async () => {
    const statusCounts = {
      NOT_SUBMITTED: 3,
      SUBMITTED: 1,
      CHANGES_REQUESTED: 0,
      REJECTED: 2,
      APPROVED: 0,
    };
    const repository = new FakeSubmissionMatrixRepository({
      page: { items: [], total: 2, statusCounts },
    });
    const service = new SubmissionMatrixService(
      repository,
      new RequirementCollectionService({} as never),
      new MilestoneCompletionService(),
    );

    const matrix = await service.matrix(
      PROGRAM_ID,
      query({
        q: '  hong  ',
        applicationMode: 'TEAM',
        status: 'REJECTED',
        sort: 'progress',
        direction: 'desc',
        page: 3,
        pageSize: 5,
      }),
    );

    expect(repository.pageCalls).toEqual([
      {
        programId: PROGRAM_ID,
        q: 'hong',
        applicationMode: 'TEAM',
        status: 'REJECTED',
        sort: 'progress',
        direction: 'desc',
        skip: 10,
        take: 5,
      },
    ]);
    expect(matrix).toMatchObject({
      rows: [],
      page: 3,
      pageSize: 5,
      total: 2,
      statusCounts,
    });
  });
});
