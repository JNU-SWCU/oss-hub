import { ApplicationStatus, SubmissionStatus } from '@prisma/client';
import type {
  SubmissionMatrixFilter,
  SubmissionMatrixQuery,
} from './domain/submission-matrix';
import {
  submissionMatrixApplicationWhere,
  type MatrixApplicationRecord,
  type MatrixMilestoneRecord,
  type MatrixSubmissionRecord,
  type SubmissionMatrixRepositoryPort,
} from './submission-matrix.repository';
import { SubmissionMatrixService } from './submission-matrix.service';
import { SubmissionsErrorCode } from './submissions-error-code.enum';

const STAFF_GITHUB_ID = 9_124_000_001n;
const OUTSIDER_GITHUB_ID = 9_124_000_002n;
const PROGRAM_ID = 'synthetic-matrix-program';

interface FakeFixtures {
  readonly milestones?: readonly MatrixMilestoneRecord[];
  readonly applications?: readonly MatrixApplicationRecord[];
  readonly total?: number;
  readonly submissions?: readonly MatrixSubmissionRecord[];
}

class FakeSubmissionMatrixRepository implements SubmissionMatrixRepositoryPort {
  readonly pageCalls: Array<{
    programId: string;
    q: string;
    applicationMode: string | null;
    skip: number;
    take: number;
  }> = [];
  readonly submissionCalls: Array<readonly string[]> = [];

  constructor(private readonly fixtures: FakeFixtures = {}) {}

  findActiveStaffOrAdmin(githubId: bigint) {
    return Promise.resolve(
      githubId === STAFF_GITHUB_ID ? { id: 'synthetic-staff' } : null,
    );
  }

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
    return Promise.resolve({
      items: this.fixtures.applications ?? [],
      total: this.fixtures.total ?? (this.fixtures.applications ?? []).length,
    });
  }

  findCurrentSubmissions(applicationIds: readonly string[]) {
    this.submissionCalls.push(applicationIds);
    return Promise.resolve(this.fixtures.submissions ?? []);
  }
}

function query(
  overrides: Partial<SubmissionMatrixQuery> = {},
): SubmissionMatrixQuery {
  return { q: '', applicationMode: null, page: 1, pageSize: 20, ...overrides };
}

describe('SubmissionMatrixService', () => {
  it('활성 STAFF·ADMIN이 아니면 403 STAFF_ONLY로 닫힌다', async () => {
    // Given
    const repository = new FakeSubmissionMatrixRepository();
    const service = new SubmissionMatrixService(repository);

    // When & Then
    await expect(
      service.matrix(OUTSIDER_GITHUB_ID, PROGRAM_ID, query()),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.STAFF_ONLY, status: 403 },
    });
    expect(repository.pageCalls).toHaveLength(0);
  });

  it('프로그램이 없으면 404 PROGRAM_NOT_FOUND', async () => {
    // Given
    const repository = new FakeSubmissionMatrixRepository();
    const service = new SubmissionMatrixService(repository);

    // When & Then
    await expect(
      service.matrix(STAFF_GITHUB_ID, 'missing-program', query()),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.PROGRAM_NOT_FOUND, status: 404 },
    });
    expect(repository.pageCalls).toHaveLength(0);
  });

  it('제출 셀은 현재 revision·reviewUrl, 미제출 셀은 NOT_SUBMITTED null들로 결합한다', async () => {
    // Given: milestone 2개 × (개인 1행 + 팀 1행), 제출은 개인×m1 한 건뿐.
    const submittedAt = new Date('2026-08-19T01:00:00.000Z');
    const repository = new FakeSubmissionMatrixRepository({
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
      applications: [
        {
          id: 'application-personal',
          applicant: { name: '합성 신청자', nickname: 'synthetic-hong' },
          team: null,
        },
        {
          id: 'application-team',
          applicant: { name: null, nickname: 'synthetic-leader' },
          team: {
            name: '합성 오픈소스팀',
            memberNicknames: ['synthetic-leader', 'synthetic-member'],
          },
        },
      ],
      submissions: [
        {
          id: 'submission-1',
          applicationId: 'application-personal',
          milestoneId: 'milestone-1',
          status: SubmissionStatus.CHANGES_REQUESTED,
          currentRevision: 2,
          submittedAt,
        },
      ],
    });
    const service = new SubmissionMatrixService(repository);

    // When
    const matrix = await service.matrix(STAFF_GITHUB_ID, PROGRAM_ID, query());

    // Then
    expect(repository.submissionCalls).toEqual([
      ['application-personal', 'application-team'],
    ]);
    expect(matrix).toEqual({
      milestones: [
        {
          id: 'milestone-1',
          name: '기획서',
          dueAt: '2026-08-20T00:00:00.000Z',
        },
        {
          id: 'milestone-2',
          name: '최종 제출',
          dueAt: '2026-09-20T00:00:00.000Z',
        },
      ],
      rows: [
        {
          applicationId: 'application-personal',
          applicationMode: 'PERSONAL',
          displayName: '합성 신청자',
          githubLogins: ['synthetic-hong'],
          cells: [
            {
              milestoneId: 'milestone-1',
              submissionId: 'submission-1',
              revision: 2,
              status: SubmissionStatus.CHANGES_REQUESTED,
              submittedAt: submittedAt.toISOString(),
              reviewUrl: `/programs/${PROGRAM_ID}/submissions/submission-1/review`,
            },
            {
              milestoneId: 'milestone-2',
              submissionId: null,
              revision: null,
              status: 'NOT_SUBMITTED',
              submittedAt: null,
              reviewUrl: null,
            },
          ],
        },
        {
          applicationId: 'application-team',
          applicationMode: 'TEAM',
          displayName: '합성 오픈소스팀',
          githubLogins: ['synthetic-leader', 'synthetic-member'],
          cells: [
            {
              milestoneId: 'milestone-1',
              submissionId: null,
              revision: null,
              status: 'NOT_SUBMITTED',
              submittedAt: null,
              reviewUrl: null,
            },
            {
              milestoneId: 'milestone-2',
              submissionId: null,
              revision: null,
              status: 'NOT_SUBMITTED',
              submittedAt: null,
              reviewUrl: null,
            },
          ],
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
  });

  it('개인형 displayName은 User.name이 없으면 nickname으로 대체한다', async () => {
    // Given
    const repository = new FakeSubmissionMatrixRepository({
      applications: [
        {
          id: 'application-personal',
          applicant: { name: null, nickname: 'synthetic-nameless' },
          team: null,
        },
      ],
    });
    const service = new SubmissionMatrixService(repository);

    // When
    const matrix = await service.matrix(STAFF_GITHUB_ID, PROGRAM_ID, query());

    // Then
    expect(matrix.rows[0]).toMatchObject({
      displayName: 'synthetic-nameless',
      githubLogins: ['synthetic-nameless'],
      cells: [],
    });
  });

  it('페이지네이션 skip/take를 계산하고 page·pageSize·total을 그대로 돌려준다', async () => {
    // Given
    const repository = new FakeSubmissionMatrixRepository({ total: 42 });
    const service = new SubmissionMatrixService(repository);

    // When
    const matrix = await service.matrix(
      STAFF_GITHUB_ID,
      PROGRAM_ID,
      query({ q: 'hong', applicationMode: 'TEAM', page: 3, pageSize: 5 }),
    );

    // Then
    expect(repository.pageCalls).toEqual([
      {
        programId: PROGRAM_ID,
        q: 'hong',
        applicationMode: 'TEAM',
        skip: 10,
        take: 5,
      },
    ]);
    expect(matrix).toMatchObject({ rows: [], page: 3, pageSize: 5, total: 42 });
  });
});

describe('submissionMatrixApplicationWhere', () => {
  it('항상 프로그램 범위의 승인 신청만 겨냥한다', () => {
    expect(
      submissionMatrixApplicationWhere(PROGRAM_ID, {
        q: '',
        applicationMode: null,
      }),
    ).toEqual({ programId: PROGRAM_ID, status: ApplicationStatus.APPROVED });
  });

  it('형태 필터(applicationMode)는 D5 이후 teamId 분기를 하지 않는다', () => {
    // D5: 모든 신청이 Team을 갖고 개인 참여는 1인 팀이다. teamId 유무 필터는 폐지됐고
    // PERSONAL/TEAM 값은 조용히 무시되어 승인 신청 전수와 같은 where를 쓴다.
    const base = {
      programId: PROGRAM_ID,
      status: ApplicationStatus.APPROVED,
    };
    expect(
      submissionMatrixApplicationWhere(PROGRAM_ID, {
        q: '',
        applicationMode: 'PERSONAL',
      }),
    ).toEqual(base);
    expect(
      submissionMatrixApplicationWhere(PROGRAM_ID, {
        q: '',
        applicationMode: 'TEAM',
      }),
    ).toEqual(base);
    expect(
      submissionMatrixApplicationWhere(PROGRAM_ID, {
        q: '',
        applicationMode: null,
      }),
    ).toEqual(base);
  });

  it('검색어는 신청자 이름·핸들·팀명·팀원 핸들을 대소문자 무시 contains로 찾는다', () => {
    const contains = { contains: 'Hong', mode: 'insensitive' };

    expect(
      submissionMatrixApplicationWhere(PROGRAM_ID, {
        q: 'Hong',
        applicationMode: null,
      }),
    ).toEqual({
      programId: PROGRAM_ID,
      status: ApplicationStatus.APPROVED,
      OR: [
        {
          applicant: { profile: { is: { name: contains } } },
        },
        { applicant: { nickname: contains } },
        { team: { name: contains } },
        { team: { members: { some: { user: { nickname: contains } } } } },
      ],
    });
  });
});
