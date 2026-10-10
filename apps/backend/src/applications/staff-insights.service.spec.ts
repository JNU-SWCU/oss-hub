import { DomainException } from '../common/error-code';
import { ApplicationsErrorCode } from './applications-error-code.enum';
import { DEPARTMENT_COHORTS } from './department-cohort';
import { StaffInsightsService } from './staff-insights.service';
import type { StaffInsightsRepository } from './staff-insights.repository';

const STAFF_GITHUB_ID = 4242n;
const DENIED_GITHUB_ID = 909n;

function repository(): Pick<
  StaffInsightsRepository,
  | 'listStudents'
  | 'listApprovedParticipations'
  | 'listActivityTotals'
  | 'findActivityDataAsOf'
  | 'listActivityYears'
> {
  return {
    listStudents: jest.fn().mockResolvedValue([
      {
        id: 'student-sw',
        githubId: 11n,
        department: '소프트웨어공학과',
      },
      {
        id: 'student-non',
        githubId: 22n,
        department: '국어국문학과',
      },
      {
        id: 'student-empty',
        githubId: 33n,
        department: null,
      },
    ]),
    listApprovedParticipations: jest.fn().mockResolvedValue([
      {
        programId: 'program-basic',
        programName: '합성 기초',
        userIds: ['student-sw', 'student-non'],
      },
    ]),
    listActivityTotals: jest.fn().mockResolvedValue([
      {
        githubId: 11n,
        commitCount: 10,
        pullRequestCount: 2,
        issueCount: 1,
        repositoryCount: 2,
        starCount: 4,
      },
      {
        githubId: 22n,
        commitCount: 1,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
      },
    ]),
    findActivityDataAsOf: jest
      .fn()
      .mockResolvedValue(new Date('2026-08-01T00:00:00.000Z')),
    listActivityYears: jest.fn().mockResolvedValue([2026, 2025]),
  };
}

function staffOnlyAuthority() {
  return jest.fn((sessionGithubId: bigint, forbidden: () => Error) =>
    sessionGithubId === STAFF_GITHUB_ID
      ? Promise.resolve({ actorId: 'actor-staff' })
      : Promise.reject(forbidden()),
  );
}

describe('StaffInsightsService', () => {
  it('splits ranking and participation by department cohort', async () => {
    const store = repository();
    const assertActiveStaff = staffOnlyAuthority();
    const service = new StaffInsightsService(store as StaffInsightsRepository, {
      assertActiveStaff,
    });

    const summary = await service.summarize(STAFF_GITHUB_ID, { kind: 'all' });

    expect(assertActiveStaff).toHaveBeenCalledWith(
      STAFF_GITHUB_ID,
      expect.any(Function),
    );
    expect(store.listActivityTotals).toHaveBeenCalledWith({});
    expect(store.findActivityDataAsOf).toHaveBeenCalledTimes(1);
    expect(store.listActivityYears).toHaveBeenCalledTimes(1);
    const sw = summary.cohorts.find(
      (row) => row.cohort === DEPARTMENT_COHORTS.SW_MAJOR,
    );
    const non = summary.cohorts.find(
      (row) => row.cohort === DEPARTMENT_COHORTS.NON_SW,
    );
    const missing = summary.cohorts.find(
      (row) => row.cohort === DEPARTMENT_COHORTS.UNREGISTERED,
    );
    expect(sw).toMatchObject({
      studentCount: 1,
      activeStudentCount: 1,
      issueCount: 1,
      repositoryCount: 2,
      starCount: 4,
      total: 19,
      participantCount: 1,
    });
    expect(non).toMatchObject({
      studentCount: 1,
      activeStudentCount: 1,
      total: 1,
      participantCount: 1,
    });
    expect(missing).toMatchObject({
      studentCount: 1,
      activeStudentCount: 0,
      total: 0,
      participantCount: 0,
    });
    expect(summary.programs[0]).toMatchObject({
      programId: 'program-basic',
      swMajorCount: 1,
      nonSwCount: 1,
      unregisteredCount: 0,
      participantCount: 2,
    });
  });

  it('passes only a numeric year into activity totals', async () => {
    const store = repository();
    const service = new StaffInsightsService(store as StaffInsightsRepository, {
      assertActiveStaff: staffOnlyAuthority(),
    });

    await service.summarize(STAFF_GITHUB_ID, { kind: 'calendar', year: 2026 });

    expect(store.listActivityTotals).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });

  it('denies a non-staff session with the staff list read contract', async () => {
    const store = repository();
    const service = new StaffInsightsService(store as StaffInsightsRepository, {
      assertActiveStaff: staffOnlyAuthority(),
    });

    const denied = service.summarize(DENIED_GITHUB_ID, { kind: 'all' });

    await expect(denied).rejects.toBeInstanceOf(DomainException);
    await expect(denied).rejects.toMatchObject({
      errorCode: {
        code: ApplicationsErrorCode.STAFF_LIST_ONLY,
        status: 403,
      },
    });
  });

  it('reads nothing when the session is not active staff', async () => {
    const store = repository();
    const service = new StaffInsightsService(store as StaffInsightsRepository, {
      assertActiveStaff: staffOnlyAuthority(),
    });

    await expect(
      service.summarize(DENIED_GITHUB_ID, { kind: 'calendar', year: 2026 }),
    ).rejects.toBeInstanceOf(DomainException);

    expect(store.listStudents).not.toHaveBeenCalled();
    expect(store.listApprovedParticipations).not.toHaveBeenCalled();
    expect(store.listActivityTotals).not.toHaveBeenCalled();
    expect(store.findActivityDataAsOf).not.toHaveBeenCalled();
    expect(store.listActivityYears).not.toHaveBeenCalled();
  });
});
