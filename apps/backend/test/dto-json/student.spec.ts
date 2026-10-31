import { ActivityTimelineResponseDto } from '../../src/student/dto/activity-timeline-response.dto';
import { MilestoneDocumentFeedbackResponseDto } from '../../src/student/dto/milestone-document-feedback-response.dto';
import { MyRepositoriesResponseDto } from '../../src/student/dto/my-repositories-response.dto';
import { StudentDashboardResponseDto } from '../../src/student/dto/student-dashboard-response.dto';
import type { MyRepositoryResult } from '../../src/github/repositories-read.types';
import type { StudentDashboardItem } from '../../src/student/student-dashboard.types';

const at = (iso: string): Date => new Date(iso);

const repository: MyRepositoryResult = {
  repositoryId: 'repository-1',
  applicationId: 'application-1',
  connectionMode: 'NEW',
  applicationMode: 'TEAM',
  programName: 'Program A',
  displayName: 'Team A',
  repositoryName: 'org/team-a',
  githubUrl: 'https://github.com/org/team-a',
  provisionStatus: 'SUCCEEDED',
  invitationStatus: 'SUCCEEDED',
  visibility: 'PRIVATE',
  lastErrorCode: null,
  updatedAt: at('2026-01-02T03:04:05.000Z'),
};

const dashboardItem: StudentDashboardItem = {
  coverImageUrl: '/api/v1/programs/program-1/cover',
  applicationId: 'application-1',
  programId: 'program-1',
  programName: 'Program A',
  teamName: 'Team A',
  teamUrl: '/programs/program-1/team',
  applicationStatus: 'APPROVED',
  nextMilestone: {
    id: 'milestone-1',
    name: 'Kickoff',
    dueAt: at('2026-02-01T00:00:00.000Z'),
    lateSubmissionDueAt: null,
    submissionStatus: 'NOT_SUBMITTED',
    requiredItemCount: 2,
    remainingItemCount: 1,
  },
  progress: { approvedCount: 1, inReviewCount: 1, totalCount: 3 },
  detailUrl: '/programs/program-1',
  checklistUrl: '/programs/program-1/submissions',
  repository: {
    repositoryName: 'org/team-a',
    provisionStatus: 'SUCCEEDED',
    invitationStatus: null,
    githubUrl: 'https://github.com/org/team-a',
  },
};

const cases: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    'ActivityTimelineResponseDto',
    () =>
      ActivityTimelineResponseDto.from({
        dataAsOf: at('2026-05-01T00:00:00.000Z'),
        programs: [
          {
            programId: 'program-1',
            programName: 'Program A',
            year: 2026,
            applicationMode: 'TEAM',
          },
        ],
        series: {
          granularity: 'MONTH',
          points: [
            {
              period: '2026-04',
              commitCount: 1,
              pullRequestCount: 2,
              releaseCount: 3,
              issueCount: 4,
              total: 10,
            },
          ],
        },
      }),
  ],
  [
    'ActivityTimelineResponseDto empty',
    () =>
      ActivityTimelineResponseDto.from({
        dataAsOf: null,
        programs: [],
        series: { granularity: 'YEAR', points: [] },
      }),
  ],
  [
    'MilestoneDocumentFeedbackResponseDto',
    () =>
      MilestoneDocumentFeedbackResponseDto.from({
        items: [
          {
            id: 'review-1',
            decision: 'CHANGES_REQUESTED',
            comment: 'Fix it',
            reviewedAt: at('2026-03-01T00:00:00.000Z'),
            resubmissionDueAt: at('2026-03-08T00:00:00.000Z'),
            applicationId: 'application-1',
            programId: 'program 1',
            milestoneId: 'milestone/1',
            milestoneName: 'Kickoff',
            itemName: 'Plan',
          },
          {
            id: 'review-2',
            decision: 'APPROVED',
            comment: null,
            reviewedAt: at('2026-03-02T00:00:00.000Z'),
            resubmissionDueAt: null,
            applicationId: 'application-1',
            programId: 'program-1',
            milestoneId: 'milestone-2',
            milestoneName: 'Final',
            itemName: 'Report',
          },
        ],
      }),
  ],
  [
    'MyRepositoriesResponseDto',
    () =>
      MyRepositoriesResponseDto.from([
        repository,
        {
          ...repository,
          repositoryId: null,
          connectionMode: 'OWN',
          applicationMode: 'PERSONAL',
          repositoryName: null,
          githubUrl: null,
          provisionStatus: 'FAILED_FINAL',
          invitationStatus: null,
          visibility: null,
          lastErrorCode: 'AUTH',
        },
      ]),
  ],
  [
    'StudentDashboardResponseDto',
    () =>
      StudentDashboardResponseDto.from([
        dashboardItem,
        {
          applicationId: 'application-2',
          programId: 'program-2',
          programName: 'Program B',
          teamName: 'Solo',
          teamUrl: '/programs/program-2/team',
          applicationStatus: 'SUBMITTED',
          nextMilestone: {
            id: 'milestone-3',
            name: 'Late',
            dueAt: at('2026-02-01T00:00:00.000Z'),
            lateSubmissionDueAt: at('2026-02-08T00:00:00.000Z'),
            submissionStatus: 'CHANGES_REQUESTED',
            requiredItemCount: 1,
            remainingItemCount: 1,
          },
          progress: null,
          detailUrl: '/programs/program-2',
          checklistUrl: '/programs/program-2/submissions',
          repository: null,
        },
        {
          ...dashboardItem,
          applicationId: 'application-3',
          nextMilestone: null,
        },
      ]),
  ],
];

describe('student response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});
