import { DEPARTMENT_COHORTS } from './department-cohort';
import { StaffInsightsService } from './staff-insights.service';
import type { StaffInsightsRepository } from './staff-insights.repository';

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

describe('StaffInsightsService', () => {
  it('splits ranking and participation by department cohort', async () => {
    const store = repository();
    const service = new StaffInsightsService(store as StaffInsightsRepository);

    const summary = await service.summarize({ kind: 'all' });

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
    const service = new StaffInsightsService(store as StaffInsightsRepository);

    await service.summarize({ kind: 'calendar', year: 2026 });

    expect(store.listActivityTotals).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });
});
