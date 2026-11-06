import { ProgramTemplatesService } from '../../src/programs/team-application.service';
import { AcceptTeamInvitationResponseDto } from '../../src/programs/dto/accept-team-invitation-response.dto';
import { ApplicationDecisionResponseDto } from '../../src/programs/dto/application-decision-response.dto';
import {
  ApplicationDetailResponseDto,
  ApplicationListItemResponseDto,
  ApplicationListPageResponseDto,
  ReviewHistoryEntryResponseDto,
} from '../../src/programs/dto/application-list-page-response.dto';
import {
  ApplicationFieldResponseDto,
  ApplicationTemplateListResponseDto,
  ApplicationTemplateResponseDto,
} from '../../src/programs/dto/application-template-response.dto';
import {
  BoardCommentResponseDto,
  BoardPostDetailResponseDto,
  BoardPostResponseDto,
  BoardPostsPageResponseDto,
} from '../../src/programs/dto/board-post-response.dto';
import { CreateApplicationResponseDto } from '../../src/programs/dto/create-application-response.dto';
import { CreateProgramResponseDto } from '../../src/programs/dto/create-program-response.dto';
import {
  EditableProgramResponseDto,
  ProgramMilestoneDocumentResponseDto,
  ProgramMilestoneEditResponseDto,
  ProgramMilestoneOperationResponseDto,
  ProgramMilestoneResponseDto,
} from '../../src/programs/dto/editable-program-response.dto';
import { InvitationCandidateResponseDto } from '../../src/programs/dto/invitation-candidate-response.dto';
import {
  MilestoneDocumentCollectionResponseDto,
  MilestoneDocumentDeliveryCollectionResponseDto,
} from '../../src/programs/dto/milestone-document-collection-response.dto';
import { MilestoneDocumentHistoryPageResponseDto } from '../../src/programs/dto/milestone-document-history-page-response.dto';
import {
  MilestoneDocumentListResponseDto,
  MilestoneDocumentResponseDto,
  MilestoneDocumentUploadPolicyResponseDto,
} from '../../src/programs/dto/milestone-document-response.dto';
import { MilestoneDocumentReviewResponseDto } from '../../src/programs/dto/milestone-document-review-response.dto';
import {
  MilestoneDocumentSubmissionFileResponseDto,
  MilestoneDocumentSubmissionResponseDto,
} from '../../src/programs/dto/milestone-document-submission-response.dto';
import { MyProgramTeamResponseDto } from '../../src/programs/dto/my-program-team-response.dto';
import { MyStudentApplicationResponseDto } from '../../src/programs/dto/my-student-application-response.dto';
import {
  ProgramActivityResponseDto,
  ProgramDetailResponseDto,
} from '../../src/programs/dto/program-detail-response.dto';
import { ProgramDocumentChangeRequestTargetsResponseDto } from '../../src/programs/dto/program-document-change-request-targets-response.dto';
import { ProgramEndedYearsResponseDto } from '../../src/programs/dto/program-ended-years-response.dto';
import {
  ProgramListPageResponseDto,
  ProgramListResponseDto,
} from '../../src/programs/dto/program-list-response.dto';
import { ProgramAuthoringUploadPolicyResponseDto } from '../../src/programs/dto/program-authoring-upload-policy-response.dto';
import { ProgramNoticePreviewResponseDto } from '../../src/programs/dto/program-notice-preview-response.dto';
import {
  MilestoneDocumentSummaryResponseDto,
  ProgramOverviewResponseDto,
  RemainingMilestoneResponseDto,
} from '../../src/programs/dto/program-overview-response.dto';
import {
  ProgramOverviewTeamMemberResponseDto,
  ProgramOverviewTeamResponseDto,
} from '../../src/programs/dto/program-overview-team-response.dto';
import { ProgramStatusCountsResponseDto } from '../../src/programs/dto/program-status-counts-response.dto';
import {
  DeleteTeamResponseDto,
  ProgramTeamResponseDto,
  RenameTeamResponseDto,
  StaffProgramTeamResponseDto,
} from '../../src/programs/dto/program-team-response.dto';
import {
  PublicProjectDetailResponseDto,
  PublicProjectPageResponseDto,
} from '../../src/programs/dto/public-project-page-response.dto';
import { PublicUserProfileResponseDto } from '../../src/programs/dto/public-user-profile-response.dto';
import { ReceivedTeamInvitationResponseDto } from '../../src/programs/dto/received-team-invitation-response.dto';
import {
  RepositoryUrlHistoryResponseDto,
  StaffTeamDetailResponseDto,
  TeamApplicationResponseDto,
} from '../../src/programs/dto/staff-team-detail-response.dto';
import { SubmissionMatrixResponseDto } from '../../src/programs/dto/submission-matrix-response.dto';
import {
  CreateSubmissionReviewResponseDto,
  RepositoryPublishResponseDto,
  SubmissionReviewContextResponseDto,
} from '../../src/programs/dto/submission-review-context-response.dto';
import { TeamActivityResponseDto } from '../../src/programs/dto/team-activity-response.dto';
import {
  TeamInvitationInviteeResponseDto,
  TeamInvitationResponseDto,
} from '../../src/programs/dto/team-invitation-response.dto';
import {
  TeamManagementListItemResponseDto,
  TeamManagementListPageResponseDto,
} from '../../src/programs/dto/team-management-list-page-response.dto';
import { DeleteProgramResponseDto } from '../../src/programs/dto/delete-program-response.dto';
import { ProgramAuthoringUploadResponseDto } from '../../src/programs/dto/program-authoring-upload-response.dto';
import { ProgramDocumentChangeRequestCountResponseDto } from '../../src/programs/dto/program-document-change-request-count-response.dto';
import { PurgeProgramResponseDto } from '../../src/programs/dto/purge-program-response.dto';
import {
  StudentApplicationCancellationResponseDto,
  StudentApplicationResponseDto,
} from '../../src/programs/dto/student-application-response.dto';
import { StudentRepositoryUrlResponseDto } from '../../src/programs/dto/student-repository-url-response.dto';
import { UploadedMilestoneDocumentFileResponseDto } from '../../src/programs/dto/uploaded-milestone-document-file-response.dto';
import { UploadedSubmissionFileResponseDto } from '../../src/programs/dto/uploaded-submission-file-response.dto';
import {
  type ApplicationListItem,
  type TeamManagementListItem,
} from '../../src/programs/team.repository';
import {
  type MilestoneDocumentCollectionResult,
  type MilestoneDocumentViewerResult,
} from '../../src/programs/requirements.service';
import { type MilestoneDocumentRecord } from '../../src/programs/requirements.repository';
import {
  type EditableProgramView,
  type ProgramMilestoneEditView,
} from '../../src/programs/program-editor.repository';
import {
  type ProgramTeamView,
  type StaffTeamDetailView,
  type TeamActivityView,
} from '../../src/programs/program-team-repository-evidence.repository';
import {
  type ProgramListPageItem,
  type ProgramDetailResult,
} from '../../src/programs/programs.service';
import {
  type BoardPostDetailResult,
  type BoardPostSummaryResult,
} from '../../src/programs/board.service';
import { type ProgramOverviewView } from '../../src/programs/program-overview.service';
import {
  type PublicProjectListItem,
  type PublicUserProfileResult,
} from '../../src/programs/public-projects.service';
import { PublicProjectApplicationMode } from '../../src/programs/public-projects.config';
import { type SubmissionReviewContext } from '../../src/programs/submissions.repository';
import { type SentTeamInvitationRecord } from '../../src/programs/team-invitations.repository';
const programTemplatesService = new ProgramTemplatesService();
const at = (iso: string): Date => new Date(iso);
const boardPost: BoardPostSummaryResult = {
  id: 'post-1',
  programId: 'program-1',
  authorId: 'user-1',
  authorName: 'Octo',
  category: 'NOTICE',
  title: 'Welcome',
  pinned: true,
  createdAt: at('2026-01-02T03:04:05.000Z'),
  commentCount: 1,
  canEdit: true,
  canDelete: false,
};
const boardDetail: BoardPostDetailResult = {
  ...boardPost,
  body: 'Hello',
  updatedAt: at('2026-01-03T03:04:05.000Z'),
  comments: [
    {
      id: 'comment-1',
      postId: 'post-1',
      authorId: 'user-2',
      authorRole: 'STAFF',
      authorName: 'Staff',
      body: 'Hi',
      createdAt: at('2026-01-04T03:04:05.000Z'),
      canDelete: true,
    },
  ],
};
const applicationItem: ApplicationListItem = {
  id: 'application-1',
  programId: 'program-1',
  status: 'SUBMITTED',
  submittedAt: at('2026-01-05T00:00:00.000Z'),
  rejectionReason: null,
  repositoryProvisioning: {
    enabled: true,
    jobStatus: 'PENDING',
    updatedAt: at('2026-01-06T00:00:00.000Z'),
    safeErrorClass: null,
  },
  repositoryConnectionMode: 'NEW',
  repositoryUrl: null,
  repository: { url: 'https://github.com/org/repo', visibility: 'PRIVATE' },
  isRepositoryPublicationPlanned: true,
  participation: 'TEAM',
  applicant: { id: 'user-1', name: 'Octo', nickname: 'octo' },
  team: { id: 'team-1', name: 'Team A', memberCount: 3 },
  answers: { applicantName: 'Octo', title: 'Project', summary: 'Summary' },
};
const reviewEntry = {
  id: 'review-entry-1',
  eventKind: 'REJECTED',
  revision: 2,
  actor: { name: null, nickname: 'staff' },
  occurredAt: at('2026-01-07T00:00:00.000Z'),
  rejectionReason: 'Incomplete',
} as const;
const milestoneView = {
  id: 'milestone-1',
  name: 'Kickoff',
  startAt: at('2026-02-01T00:00:00.000Z'),
  dueAt: at('2026-02-10T00:00:00.000Z'),
  instructions: null,
} as const;
const milestoneEditView: ProgramMilestoneEditView = {
  milestone: milestoneView,
  operation: {
    startAt: at('2026-01-01T00:00:00.000Z'),
    endAt: at('2026-06-30T00:00:00.000Z'),
  },
  documents: [
    {
      submissionType: 'FILE_OR_TEXT' as const,
      id: 'document-1',
      name: 'Plan',
      required: true,
      sortOrder: 0,
      templateFileName: 'plan.hwp',
    },
  ],
  fingerprint: 'fingerprint-1',
};
const editableProgram: EditableProgramView = {
  externalCover: {
    sourceUrl: 'https://notice.example/1',
    imageUrl: 'https://images.example/1.png',
  },
  coverImageUrl: null,
  id: 'program-1',
  name: 'Program A',
  organizer: 'Org',
  trackType: 'CURRICULAR',
  applicationTemplateKey: 'v1',
  applicationTemplateVersion: 1,
  applicationCount: 4,
  teamCount: 2,
  deletionScopeCounts: {
    applications: 4,
    teams: 2,
    boardPosts: 1,
    submissions: 3,
    submissionEvents: 5,
    scopeFingerprint: 'scope-1',
  },
  applicationStartAt: at('2026-01-01T00:00:00.000Z'),
  applicationEndAt: at('2026-01-31T00:00:00.000Z'),
  startAt: at('2026-02-01T00:00:00.000Z'),
  endAt: '2026-06-30',
  teamMinSize: 1,
  teamMaxSize: 4,
  repositoryProvisioningEnabled: true,
  notifyOnDeadline: false,
  description: 'Description',
  milestones: [milestoneView],
};
const documentRecord: MilestoneDocumentRecord = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: 'Plan',
  required: true,
  submissionType: 'FILE_OR_TEXT' as const,
  sortOrder: 0,
  graceDueAt: at('2026-02-12T00:00:00.000Z'),
  templateFileId: 'file-1',
  templateFileName: 'plan.hwp',
};
const optionalDocumentRecord: MilestoneDocumentRecord = {
  ...documentRecord,
  id: 'document-2',
  name: 'Text',
  required: false,
  sortOrder: 1,
  graceDueAt: null,
  templateFileId: null,
  templateFileName: null,
};
const collectionResult: MilestoneDocumentCollectionResult = {
  milestone: {
    id: 'milestone-1',
    programId: 'program-1',
    name: 'Kickoff',
    dueAt: at('2026-02-10T00:00:00.000Z'),
  },
  documents: [documentRecord, optionalDocumentRecord],
  rows: [
    {
      application: {
        teamId: 'application-1',
        teamName: 'Team A',
        applicantName: 'Octo',
        memberNicknames: ['octo', 'cat'],
      },
      cells: [
        {
          milestoneDocumentId: 'document-1',
          teamId: 'application-1',
          submittedAt: at('2026-02-09T00:00:00.000Z'),
          revision: 2,
          status: 'CHANGES_REQUESTED',
          file: { originalFileName: 'plan.pdf', sizeBytes: 1024 },
          content: null,
          review: {
            id: 'review-1',
            decision: 'CHANGES_REQUESTED',
            comment: 'Fix',
            reviewedAt: at('2026-02-09T12:00:00.000Z'),
          },
        },
        {
          milestoneDocumentId: 'document-2',
          teamId: 'application-1',
          submittedAt: at('2026-02-09T01:00:00.000Z'),
          revision: 1,
          status: 'SUBMITTED',
          file: null,
          content: { type: 'TEXT', text: 'hello' },
          review: null,
        },
      ],
    },
    {
      application: {
        teamId: 'application-2',
        teamName: 'Solo',
        applicantName: null,
        memberNicknames: [],
      },
      cells: [null, null],
    },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
  filterCounts: { all: 2, hasMissing: 1, zeroSubmission: 1 },
  documentTotals: [
    { documentId: 'document-1', submitted: 1, total: 2 },
    { documentId: 'document-2', submitted: 1, total: 2 },
  ],
};
const viewerResult: MilestoneDocumentViewerResult = {
  ...documentRecord,
  viewerSubmission: {
    submitted: true,
    submittedAt: at('2026-02-09T00:00:00.000Z'),
    submittedLate: false,
    revision: 1,
    status: 'SUBMITTED',
    hasCurrentFile: true,
    currentFileName: 'plan.pdf',
    review: {
      comment: null,
      reviewedAt: at('2026-02-09T12:00:00.000Z'),
    },
    history: { hasHistory: true, isComplete: false },
  },
  teamSubmissionCount: { submitted: 2, total: 3 },
};
const programListItem: ProgramListPageItem = {
  id: 'program-1',
  name: 'Program A',
  organizer: 'Org',
  trackType: 'CURRICULAR',
  applicationTemplateKey: 'v1',
  applicationStartAt: at('2026-01-01T00:00:00.000Z'),
  applicationEndAt: at('2026-01-31T00:00:00.000Z'),
  endAt: at('2026-06-30T00:00:00.000Z'),
  description: 'Description',
  teamMinSize: 1,
  teamMaxSize: 4,
  coverId: 'cover-1',
  coverExternalImageUrl: null,
  coverImageUrl: '/programs/program-1/cover/cover-1',
  note: { text: 'Team needed', icon: 'team' },
  viewerApplicationStatus: 'SUBMITTED',
  applicationCount: 3,
  pendingApplicationCount: 1,
};
const programDetail: ProgramDetailResult = {
  teamMinSize: 2,
  teamMaxSize: 4,
  coverImageUrl: null,
  id: 'program-1',
  name: 'Program A',
  organizer: 'Org',
  trackType: null,
  applicationTemplateKey: 'v1',
  description: 'Description',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: at('2026-01-01T00:00:00.000Z'),
    endsAt: at('2026-01-31T00:00:00.000Z'),
  },
  operatingPeriod: {
    startsAt: at('2026-02-01T00:00:00.000Z'),
    endsAt: at('2026-06-30T00:00:00.000Z'),
  },
  viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
  milestones: [
    {
      id: 'milestone-1',
      name: 'Kickoff',
      startAt: at('2026-02-01T00:00:00.000Z'),
      dueAt: at('2026-02-10T00:00:00.000Z'),
      dDay: 3,
      deadlineLabel: 'D-3',
      description: null,
      submissionItemCount: 2,
      viewerSubmissionStatus: 'NOT_SUBMITTED',
      applicationSubmissionSummary: {
        notSubmitted: 1,
        submitted: 2,
        approved: 3,
        changesRequested: 4,
        rejected: 5,
        total: 15,
      },
    },
    {
      id: 'milestone-2',
      name: 'Final',
      startAt: at('2026-03-01T00:00:00.000Z'),
      dueAt: at('2026-03-10T00:00:00.000Z'),
      dDay: -1,
      deadlineLabel: 'Closed',
      description: 'Final report',
      submissionItemCount: 0,
      viewerSubmissionStatus: null,
      applicationSubmissionSummary: null,
    },
  ],
};
const overview: ProgramOverviewView = {
  programId: 'program-1',
  name: 'Program A',
  trackType: null,
  milestoneCount: 2,
  boardPostCount: 3,
  participantCount: 10,
  teamCount: 4,
  connectedRepositoryCount: 3,
  remainingMilestones: [
    { label: 'Kickoff', dueAt: at('2026-02-10T00:00:00.000Z') },
  ],
  viewer: {
    role: 'STAFF',
    myDocumentsCompleted: null,
    myDocumentsTotal: null,
    fullySubmittedParticipantCount: 4,
    milestoneDocuments: [
      { milestoneId: 'milestone-1', title: 'Kickoff', completed: 1, total: 2 },
    ],
  },
};
const teamMembers = [
  { userId: 'user-1', nickname: 'octo', name: 'Octo', isLeader: true },
  { userId: 'user-2', nickname: 'cat', name: null, isLeader: false },
];
const programTeam: ProgramTeamView = {
  id: 'team-1',
  name: 'Team A',
  memberCount: 2,
  minMembers: 1,
  maxMembers: 4,
  status: 'SUBMITTED',
  canInvite: true,
  canRemoveMembers: true,
  canLeave: false,
  isLeader: true,
  members: teamMembers,
};
const projectRow: PublicProjectListItem = {
  id: 'row-1',
  projectId: 'project-1',
  githubRepositoryId: 99n,
  repositoryName: 'org/team-a',
  githubUrl: 'https://github.com/org/team-a',
  publishedAt: at('2026-07-01T00:00:00.000Z'),
  programId: 'program-1',
  programName: 'Program A',
  trackType: 'CURRICULAR',
  teamName: 'Team A',
  teamMemberCount: 3,
  applicantNickname: 'octo',
  applicationMode: PublicProjectApplicationMode.TEAM,
  displayName: 'Team A',
};
const soloProjectRow: PublicProjectListItem = {
  ...projectRow,
  id: 'row-2',
  projectId: 'project-2',
  trackType: null,
  teamName: null,
  teamMemberCount: 1,
  applicationMode: PublicProjectApplicationMode.PERSONAL,
  displayName: 'octo',
};
const metrics = { commitCount: 10, pullRequestCount: 4, releaseCount: 1 };
const publicProfile: PublicUserProfileResult = {
  identity: {
    userId: 'user-1',
    githubNickname: 'octo',
    avatarUrl: null,
    githubId: 5n,
  },
  projects: [
    {
      row: projectRow,
      observed: true,
      hasCollectedData: true,
      dataAsOf: at('2026-07-02T00:00:00.000Z'),
      metrics,
    },
    {
      row: soloProjectRow,
      observed: false,
      hasCollectedData: false,
      dataAsOf: null,
      metrics: null,
    },
  ],
  observedTotals: metrics,
};
const staffTeamDetail: StaffTeamDetailView = {
  teamId: 'team-1',
  name: 'Team A',
  memberCount: 2,
  members: teamMembers,
  application: {
    id: 'application-1',
    status: 'APPROVED',
    repositoryConnectionMode: 'NEW',
    repository: {
      id: 'repository-1',
      url: 'https://github.com/org/team-a',
      visibility: 'PRIVATE',
      publishEligible: false,
      blockedReasons: ['PROGRAM_NOT_ENDED'],
    },
    repositoryProvisioning: {
      enabled: true,
      jobStatus: 'SUCCEEDED',
      updatedAt: at('2026-02-01T00:00:00.000Z'),
      safeErrorClass: null,
    },
  },
  deletionScope: {
    teams: 1,
    members: 2,
    invitations: 0,
    submissions: 3,
    submissionEvents: 4,
    detachedRepositories: 1,
    scopeFingerprint: 'scope-1',
  },
  repositoryContributions: null,
  repositoryUrlHistory: {
    items: [
      {
        id: 'history-1',
        occurredAt: '2026-02-02T00:00:00.000Z',
        actorGithubLogin: 'octo',
        previousRepositoryUrl: null,
        newRepositoryUrl: 'https://github.com/org/team-a',
      },
    ],
    nextCursor: 'cursor-1',
  },
};
const teamActivity: TeamActivityView = {
  teamId: 'application-1',
  repository: { id: 'repository-1', url: 'https://github.com/org/team-a' },
  status: 'COLLECTED',
  lastSuccessAt: '2026-05-01T00:00:00.000Z',
  window: {
    from: '2026-02-01',
    to: '2026-06-30',
    timeZone: 'Asia/Seoul',
  },
  canEditRepositoryUrl: true,
  members: [
    {
      userId: 'user-1',
      githubLogin: 'octo',
      totals: { commitCount: 3, pullRequestCount: 2, issueCount: 1 },
      points: [
        {
          date: '2026-02-01',
          commitCount: 3,
          pullRequestCount: 2,
          issueCount: 1,
        },
      ],
    },
  ],
};
const sentInvitation: SentTeamInvitationRecord = {
  id: 'invitation-1',
  teamId: 'team-1',
  programId: 'program-1',
  inviteeId: 'user-2',
  invitedById: 'user-1',
  invitedAt: at('2026-01-10T00:00:00.000Z'),
  invitee: {
    id: 'user-2',
    nickname: 'cat',
    name: null,
    avatarUrl: 'https://avatars.example/cat.png',
  },
};
const teamManagementItem: TeamManagementListItem = {
  teamMinSize: 2,
  id: 'application-1',
  programId: 'program-1',
  status: 'APPROVED',
  submittedAt: at('2026-01-05T00:00:00.000Z'),
  rejectionReason: null,
  applicant: { id: 'user-1', name: 'Octo', nickname: 'octo' },
  team: {
    id: 'team-1',
    name: 'Team A',
    memberCount: 2,
    members: [
      { id: 'user-1', name: 'Octo', nickname: 'octo' },
      { id: 'user-2', name: null, nickname: 'cat' },
    ],
  },
};
const reviewContext: SubmissionReviewContext = {
  latestReviewId: null,
  requirementId: 'requirement-1',
  submissionId: 'submission-1',
  application: {
    id: 'application-1',
    applicationMode: 'TEAM',
    displayName: 'Team A',
  },
  milestone: { id: 'milestone-1', name: 'Kickoff' },
  currentRevision: {
    number: 2,
    content: { text: 'hello' },
    comment: 'Second try',
    submittedAt: at('2026-02-09T00:00:00.000Z'),
    files: [
      {
        fileId: 'file-1',
        fileName: 'plan.pdf',
        contentType: 'application/pdf',
        size: 1024,
        expiresAt: at('2026-02-09T01:00:00.000Z'),
        downloadUrl: '/api/v1/submission-files/file-1',
      },
    ],
    review: null,
  },
  history: [
    {
      number: 1,
      content: null,
      comment: null,
      submittedAt: at('2026-02-08T00:00:00.000Z'),
      files: [],
      review: {
        id: 'review-1',
        decision: 'CHANGES_REQUESTED',
        comment: 'Fix',
        reviewedAt: at('2026-02-08T12:00:00.000Z'),
      },
    },
  ],
  repository: {
    id: 'repository-1',
    url: 'https://github.com/org/team-a',
    visibility: 'PRIVATE',
    publishEligible: true,
    blockedReasons: [],
  },
};
const cases: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    'AcceptTeamInvitationResponseDto',
    () =>
      AcceptTeamInvitationResponseDto.from({
        teamId: 'team-1',
        programId: 'program-1',
      }),
  ],
  [
    'ApplicationDecisionResponseDto approved',
    () =>
      ApplicationDecisionResponseDto.from({
        kind: 'APPROVED',
        teamId: 'application-1',
        status: 'APPROVED',
        repositoryProvisioning: {
          enabled: true,
          eventId: 'event-1',
          jobStatus: 'PENDING',
        },
      }),
  ],
  [
    'ApplicationDecisionResponseDto rejected',
    () =>
      ApplicationDecisionResponseDto.from({
        kind: 'REJECTED',
        teamId: 'application-1',
        status: 'REJECTED',
        rejectionReason: 'No',
      }),
  ],
  [
    'ApplicationDecisionResponseDto reverted',
    () =>
      ApplicationDecisionResponseDto.from({
        kind: 'REVERTED',
        teamId: 'application-1',
        status: 'SUBMITTED',
      }),
  ],
  [
    'ApplicationListItemResponseDto',
    () => ApplicationListItemResponseDto.from(applicationItem),
  ],
  [
    'ApplicationListPageResponseDto',
    () =>
      ApplicationListPageResponseDto.from({
        items: [
          applicationItem,
          {
            ...applicationItem,
            id: 'application-2',
            status: 'REJECTED',
            rejectionReason: 'No',
            repositoryProvisioning: {
              enabled: false,
              jobStatus: 'FAILED_FINAL',
              updatedAt: at('2026-01-06T00:00:00.000Z'),
              safeErrorClass: 'AUTH',
            },
            repositoryConnectionMode: 'OWN',
            repositoryUrl: 'https://github.com/me/own',
            repository: null,
            participation: 'INDIVIDUAL',
            team: null,
          },
        ],
        page: 1,
        pageSize: 20,
        totalItems: 2,
        totalPages: 1,
      }),
  ],
  [
    'ReviewHistoryEntryResponseDto',
    () => ReviewHistoryEntryResponseDto.from(reviewEntry),
  ],
  [
    'ApplicationDetailResponseDto',
    () =>
      ApplicationDetailResponseDto.from({
        application: applicationItem,
        reviewHistory: [reviewEntry],
      }),
  ],
  ...programTemplatesService
    .listProgramTemplates()
    .flatMap((template): ReadonlyArray<readonly [string, () => unknown]> => [
      [
        `ApplicationTemplateResponseDto ${template.key}`,
        () => ApplicationTemplateResponseDto.from(template),
      ],
    ]),
  [
    'ApplicationFieldResponseDto',
    () =>
      ApplicationFieldResponseDto.from(
        programTemplatesService.listProgramTemplates()[0]!.fields[0]!,
      ),
  ],
  [
    'ApplicationTemplateListResponseDto',
    () =>
      ApplicationTemplateListResponseDto.from(
        programTemplatesService.listProgramTemplates(),
      ),
  ],
  ['BoardPostResponseDto', () => BoardPostResponseDto.from(boardPost)],
  [
    'BoardCommentResponseDto',
    () => BoardCommentResponseDto.from(boardDetail.comments[0]!),
  ],
  [
    'BoardPostDetailResponseDto',
    () => BoardPostDetailResponseDto.from(boardDetail),
  ],
  [
    'BoardPostsPageResponseDto',
    () =>
      BoardPostsPageResponseDto.from({
        items: [boardPost],
        total: 1,
        page: 1,
        limit: 10,
      }),
  ],
  [
    'CreateApplicationResponseDto',
    () =>
      CreateApplicationResponseDto.from({
        id: 'application-1',
        programId: 'program-1',
        status: 'SUBMITTED',
        teamId: 'team-1',
        submittedAt: at('2026-01-05T00:00:00.000Z'),
        isRepositoryPublicationPlanned: false,
        repositoryConnectionMode: 'NEW',
        repositoryUrl: null,
      }),
  ],
  [
    'CreateProgramResponseDto',
    () =>
      CreateProgramResponseDto.from({
        id: 'program-1',
        category: 'BASIC',
        applicationTemplateKey: 'v1',
        applicationTemplateVersion: 1,
        endAt: at('2026-06-30T00:00:00.000Z'),
      }),
  ],
  [
    'ProgramMilestoneResponseDto',
    () => ProgramMilestoneResponseDto.from(milestoneView),
  ],
  [
    'ProgramMilestoneDocumentResponseDto',
    () =>
      ProgramMilestoneDocumentResponseDto.from(milestoneEditView.documents[0]!),
  ],
  [
    'ProgramMilestoneOperationResponseDto',
    () =>
      ProgramMilestoneOperationResponseDto.from(milestoneEditView.operation),
  ],
  [
    'ProgramMilestoneEditResponseDto',
    () => ProgramMilestoneEditResponseDto.from(milestoneEditView),
  ],
  [
    'EditableProgramResponseDto',
    () => EditableProgramResponseDto.from(editableProgram),
  ],
  [
    'EditableProgramResponseDto optional absent',
    () =>
      EditableProgramResponseDto.from({
        ...editableProgram,
        externalCover: undefined,
        coverImageUrl: undefined,
        deletionScopeCounts: undefined,
        milestones: [],
      }),
  ],
  [
    'InvitationCandidateResponseDto',
    () =>
      InvitationCandidateResponseDto.from({
        id: 'user-2',
        nickname: 'cat',
        name: null,
        avatarUrl: null,
      }),
  ],
  [
    'MilestoneDocumentCollectionResponseDto',
    () => MilestoneDocumentCollectionResponseDto.from(collectionResult),
  ],
  [
    'MilestoneDocumentDeliveryCollectionResponseDto',
    () =>
      MilestoneDocumentDeliveryCollectionResponseDto.from({
        ...collectionResult,
        rows: [
          { ...collectionResult.rows[0]!, deliveryStatus: 'LATE' },
          { ...collectionResult.rows[1]!, deliveryStatus: 'MISSING' },
        ],
        deliveryCounts: {
          missing: 1,
          late: 1,
          complete: 0,
          noRequiredItems: 0,
        },
      }),
  ],
  [
    'MilestoneDocumentHistoryPageResponseDto',
    () =>
      MilestoneDocumentHistoryPageResponseDto.from({
        items: [
          {
            event: 'SUBMITTED',
            revision: 1,
            actorNickname: 'octo',
            comment: null,
            createdAt: at('2026-02-09T00:00:00.000Z'),
            fileName: 'plan.pdf',
            downloadableFileId: 'file-1',
            content: null,
          },
          {
            event: 'CHANGES_REQUESTED',
            revision: null,
            actorNickname: 'staff',
            comment: 'Fix',
            createdAt: at('2026-02-09T12:00:00.000Z'),
            fileName: null,
            downloadableFileId: null,
            content: { type: 'TEXT', text: 'hello' },
          },
        ],
        nextCursor: null,
        isComplete: true,
      }),
  ],
  [
    'MilestoneDocumentResponseDto plain',
    () => MilestoneDocumentResponseDto.from(optionalDocumentRecord),
  ],
  [
    'MilestoneDocumentResponseDto viewer',
    () => MilestoneDocumentResponseDto.from(viewerResult),
  ],
  [
    'MilestoneDocumentResponseDto viewer without submission',
    () =>
      MilestoneDocumentResponseDto.from({
        ...documentRecord,
        teamSubmissionCount: { submitted: 0, total: 3 },
      }),
  ],
  [
    'MilestoneDocumentResponseDto viewer review null',
    () =>
      MilestoneDocumentResponseDto.from({
        ...documentRecord,
        viewerSubmission: {
          ...viewerResult.viewerSubmission!,
          submittedAt: null,
          review: null,
        },
      }),
  ],
  [
    'MilestoneDocumentUploadPolicyResponseDto',
    () => MilestoneDocumentUploadPolicyResponseDto.from(),
  ],
  [
    'MilestoneDocumentListResponseDto',
    () =>
      MilestoneDocumentListResponseDto.from([
        MilestoneDocumentResponseDto.from(documentRecord),
        MilestoneDocumentResponseDto.from(viewerResult),
      ]),
  ],
  [
    'MilestoneDocumentReviewResponseDto',
    () =>
      MilestoneDocumentReviewResponseDto.from({
        id: 'review-1',
        decision: 'APPROVED',
        comment: null,
        reviewedAt: at('2026-02-09T12:00:00.000Z'),
        reviewerNickname: 'staff',
      }),
  ],
  [
    'MilestoneDocumentSubmissionFileResponseDto',
    () =>
      MilestoneDocumentSubmissionFileResponseDto.from({
        id: 'file-1',
        originalFileName: 'plan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
  ],
  [
    'MilestoneDocumentSubmissionResponseDto',
    () =>
      MilestoneDocumentSubmissionResponseDto.from({
        id: 'submission-1',
        status: 'SUBMITTED',
        content: { type: 'TEXT', text: 'hello' },
        submittedAt: at('2026-02-09T00:00:00.000Z'),
        files: [
          {
            id: 'file-1',
            originalFileName: 'plan.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          },
        ],
      }),
  ],
  ['MyProgramTeamResponseDto none', () => MyProgramTeamResponseDto.from(null)],
  [
    'MyProgramTeamResponseDto leader',
    () => MyProgramTeamResponseDto.from(programTeam),
  ],
  [
    'MyProgramTeamResponseDto member',
    () => MyProgramTeamResponseDto.from({ ...programTeam, isLeader: false }),
  ],
  [
    'ProgramDetailResponseDto',
    () => ProgramDetailResponseDto.from(programDetail),
  ],
  [
    'ProgramActivityResponseDto',
    () =>
      ProgramActivityResponseDto.from({
        teamId: 'application-1',
        label: 'Team A',
        commitCount: 1,
        pullRequestCount: 2,
        releaseCount: 3,
        lastActivityAt: at('2026-05-01T00:00:00.000Z'),
        dataAsOf: null,
        collectionStatus: 'READY',
        members: [
          {
            githubLogin: 'octo',
            commitCount: 1,
            pullRequestCount: 2,
            releaseCount: 3,
          },
        ],
        hasIncompleteContributions: false,
      }),
  ],
  [
    'ProgramDocumentChangeRequestTargetsResponseDto',
    () =>
      ProgramDocumentChangeRequestTargetsResponseDto.from({
        counts: {
          SUBMITTED: 1,
          CHANGES_REQUESTED: 2,
          APPROVED: 3,
          REJECTED: 4,
        },
        version: 'version-1',
      }),
  ],
  [
    'ProgramEndedYearsResponseDto',
    () => ProgramEndedYearsResponseDto.from([2025, 2024]),
  ],
  [
    'ProgramListResponseDto',
    () => ProgramListResponseDto.from(programListItem),
  ],
  [
    'ProgramListPageResponseDto',
    () =>
      ProgramListPageResponseDto.from({
        items: [
          programListItem,
          {
            coverImageUrl: 'https://images.example/2.png',
            id: 'program-2',
            name: 'Program B',
            organizer: 'Org',
            trackType: null,
            applicationTemplateKey: 'v1',
            applicationStartAt: at('2026-01-01T00:00:00.000Z'),
            applicationEndAt: at('2026-01-31T00:00:00.000Z'),
            endAt: at('2026-06-30T00:00:00.000Z'),
            description: 'Description',
            teamMinSize: 1,
            teamMaxSize: 1,
            coverExternalImageUrl: 'https://images.example/2.png',
          },
        ],
        page: 1,
        pageSize: 12,
        totalItems: 2,
        totalPages: 1,
      }),
  ],
  [
    'ProgramAuthoringUploadPolicyResponseDto',
    () => ProgramAuthoringUploadPolicyResponseDto.from(),
  ],
  [
    'ProgramNoticePreviewResponseDto',
    () =>
      ProgramNoticePreviewResponseDto.from({
        sourceUrl: 'https://notice.example/1',
        name: 'Notice',
        description: 'Body',
        coverImages: ['https://images.example/1.png'],
        warnings: ['MULTIPLE_IMAGES'],
      }),
  ],
  [
    'RemainingMilestoneResponseDto',
    () => RemainingMilestoneResponseDto.from(overview.remainingMilestones[0]!),
  ],
  [
    'MilestoneDocumentSummaryResponseDto',
    () =>
      MilestoneDocumentSummaryResponseDto.from(
        overview.viewer.milestoneDocuments[0]!,
      ),
  ],
  [
    'ProgramOverviewResponseDto',
    () => ProgramOverviewResponseDto.from(overview),
  ],
  [
    'ProgramOverviewTeamMemberResponseDto',
    () =>
      ProgramOverviewTeamMemberResponseDto.from({
        userId: 'user-1',
        displayName: 'Octo',
        isLeader: true,
      }),
  ],
  [
    'ProgramOverviewTeamResponseDto',
    () =>
      ProgramOverviewTeamResponseDto.from({
        teamId: 'team-1',
        name: 'Team A',
        members: [
          { userId: 'user-1', displayName: 'Octo', isLeader: true },
          { userId: 'user-2', displayName: 'cat', isLeader: false },
        ],
      }),
  ],
  [
    'ProgramStatusCountsResponseDto',
    () =>
      ProgramStatusCountsResponseDto.from({
        all: 10,
        recruiting: 2,
        in_progress: 3,
        upcoming: 4,
        ended: 1,
      }),
  ],
  [
    'RenameTeamResponseDto',
    () => RenameTeamResponseDto.from({ teamId: 'team-1', name: 'Renamed' }),
  ],
  [
    'DeleteTeamResponseDto',
    () =>
      DeleteTeamResponseDto.from({
        teamId: 'team-1',
        deleted: true,
        deletedCounts: {
          teams: 1,
          members: 2,
          invitations: 3,
          submissions: 4,
          submissionEvents: 5,
          detachedRepositories: 6,
        },
      }),
  ],
  [
    'StaffProgramTeamResponseDto',
    () =>
      StaffProgramTeamResponseDto.from({
        teamId: 'team-1',
        name: 'Team A',
        memberCount: 2,
        members: teamMembers,
      }),
  ],
  [
    'StaffProgramTeamResponseDto fromAll',
    () =>
      [
        {
          teamId: 'team-1',
          name: 'Team A',
          memberCount: 2,
          members: teamMembers,
        },
        { teamId: 'team-2', name: 'Team B', memberCount: 0, members: [] },
      ].map((view) => StaffProgramTeamResponseDto.from(view)),
  ],
  ['ProgramTeamResponseDto', () => ProgramTeamResponseDto.from(programTeam)],
  [
    'PublicProjectPageResponseDto',
    () =>
      PublicProjectPageResponseDto.from({
        items: [projectRow, soloProjectRow],
        pageSize: 2,
        nextPageId: 'row-2',
      }),
  ],
  [
    'PublicProjectDetailResponseDto',
    () =>
      PublicProjectDetailResponseDto.from({
        row: projectRow,
        metrics,
        contributors: [
          {
            githubLogin: 'octo',
            commitCount: 5,
            pullRequestCount: 2,
            releaseCount: 1,
          },
        ],
      }),
  ],
  [
    'PublicUserProfileResponseDto',
    () => PublicUserProfileResponseDto.from(publicProfile),
  ],
  [
    'ReceivedTeamInvitationResponseDto',
    () =>
      ReceivedTeamInvitationResponseDto.from({
        id: 'invitation-1',
        teamId: 'team-1',
        programId: 'program-1',
        inviteeId: 'user-2',
        invitedById: 'user-1',
        invitedAt: at('2026-01-10T00:00:00.000Z'),
        teamName: 'Team A',
        programName: 'Program A',
        invitedByDisplayName: 'Octo',
        memberCount: 2,
        teamMaxSize: 4,
      }),
  ],
  [
    'RepositoryUrlHistoryResponseDto',
    () =>
      RepositoryUrlHistoryResponseDto.from(
        staffTeamDetail.repositoryUrlHistory,
      ),
  ],
  [
    'TeamApplicationResponseDto',
    () => TeamApplicationResponseDto.from(staffTeamDetail.application!),
  ],
  [
    'StaffTeamDetailResponseDto',
    () => StaffTeamDetailResponseDto.from(staffTeamDetail),
  ],
  [
    'StaffTeamDetailResponseDto no application',
    () =>
      StaffTeamDetailResponseDto.from({
        ...staffTeamDetail,
        application: null,
      }),
  ],
  [
    'SubmissionMatrixResponseDto',
    () =>
      SubmissionMatrixResponseDto.from(
        {
          milestones: [
            {
              id: 'milestone-1',
              name: 'Kickoff',
              dueAt: at('2026-02-10T00:00:00.000Z'),
            },
          ],
          rows: [
            {
              teamId: 'application-1',
              applicationMode: 'TEAM',
              displayName: 'Team A',
              githubLogins: ['octo', 'cat'],
              cells: [
                {
                  milestoneId: 'milestone-1',
                  submissionId: 'submission-1',
                  revision: 2,
                  status: 'SUBMITTED',
                  submittedAt: at('2026-02-09T00:00:00.000Z'),
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
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        },
        'program-1',
      ),
  ],
  [
    'SubmissionReviewContextResponseDto',
    () => SubmissionReviewContextResponseDto.from(reviewContext),
  ],
  [
    'SubmissionReviewContextResponseDto no repository',
    () =>
      SubmissionReviewContextResponseDto.from({
        ...reviewContext,
        history: [],
        repository: null,
      }),
  ],
  [
    'CreateSubmissionReviewResponseDto',
    () =>
      CreateSubmissionReviewResponseDto.from({
        reviewId: 'review-1',
        submissionStatus: 'APPROVED',
      }),
  ],
  [
    'RepositoryPublishResponseDto',
    () =>
      RepositoryPublishResponseDto.from({
        repositoryId: 'repository-1',
        visibility: 'PUBLIC',
        publishedAt: at('2026-07-01T00:00:00.000Z'),
      }),
  ],
  ['TeamActivityResponseDto', () => TeamActivityResponseDto.from(teamActivity)],
  [
    'TeamInvitationInviteeResponseDto',
    () => TeamInvitationInviteeResponseDto.from(sentInvitation.invitee),
  ],
  [
    'TeamInvitationResponseDto',
    () => TeamInvitationResponseDto.from(sentInvitation),
  ],
  [
    'TeamManagementListItemResponseDto',
    () => TeamManagementListItemResponseDto.from(teamManagementItem),
  ],
  [
    'TeamManagementListPageResponseDto',
    () =>
      TeamManagementListPageResponseDto.from({
        items: [teamManagementItem, { ...teamManagementItem, team: null }],
        page: 1,
        pageSize: 20,
        totalItems: 2,
        totalPages: 1,
      }),
  ],
  [
    'DeleteProgramResponseDto',
    () => DeleteProgramResponseDto.from({ id: 'program-1', deleted: true }),
  ],
  [
    'PurgeProgramResponseDto',
    () =>
      PurgeProgramResponseDto.from({
        id: 'program-1',
        deleted: true,
        deletedCounts: { files: 10 },
      }),
  ],
  [
    'ProgramAuthoringUploadResponseDto',
    () =>
      ProgramAuthoringUploadResponseDto.from({
        id: 'upload-1',
        fileName: 'guide.pdf',
        contentType: 'application/pdf',
        size: 1024,
        expiresAt: '2026-05-02T00:00:00.000Z',
      }),
  ],
  [
    'ProgramDocumentChangeRequestCountResponseDto',
    () =>
      ProgramDocumentChangeRequestCountResponseDto.from({ requestedCount: 3 }),
  ],
  [
    'MyStudentApplicationResponseDto none',
    () => MyStudentApplicationResponseDto.from(null),
  ],
  [
    'MyStudentApplicationResponseDto application',
    () =>
      MyStudentApplicationResponseDto.from({
        id: 'application-1',
        programId: 'program-1',
        status: 'SUBMITTED',
        teamId: 'team-1',
        answers: { applicantName: 'Octo', title: 'Project' },
        submittedAt: at('2026-01-02T03:04:05.000Z'),
        updatedAt: at('2026-01-03T03:04:05.000Z'),
        isRepositoryPublicationPlanned: true,
        rejectionReason: null,
        isManager: true,
        canManage: true,
      }),
  ],
  [
    'StudentApplicationResponseDto manager',
    () =>
      StudentApplicationResponseDto.from({
        id: 'application-1',
        programId: 'program-1',
        status: 'SUBMITTED',
        teamId: 'team-1',
        answers: { applicantName: 'Octo', title: 'Project' },
        submittedAt: at('2026-01-02T03:04:05.000Z'),
        updatedAt: at('2026-01-03T03:04:05.000Z'),
        isRepositoryPublicationPlanned: true,
        rejectionReason: null,
        isManager: true,
        canManage: true,
      }),
  ],
  [
    'StudentApplicationResponseDto rejected member',
    () =>
      StudentApplicationResponseDto.from({
        id: 'application-1',
        programId: 'program-1',
        status: 'REJECTED',
        teamId: null,
        answers: { applicantName: 'Octo', title: 'Project' },
        submittedAt: at('2026-01-02T03:04:05.000Z'),
        updatedAt: at('2026-01-03T03:04:05.000Z'),
        isRepositoryPublicationPlanned: false,
        rejectionReason: 'Not eligible',
        isManager: false,
        canManage: false,
      }),
  ],
  [
    'StudentApplicationCancellationResponseDto',
    () => StudentApplicationCancellationResponseDto.from({ cancelled: true }),
  ],
  [
    'StudentRepositoryUrlResponseDto',
    () =>
      StudentRepositoryUrlResponseDto.from({
        repositoryUrl: 'https://github.com/org/repo',
        canEditRepositoryUrl: true,
      }),
  ],
  [
    'StudentRepositoryUrlResponseDto empty',
    () =>
      StudentRepositoryUrlResponseDto.from({
        repositoryUrl: null,
        canEditRepositoryUrl: false,
      }),
  ],
  [
    'UploadedMilestoneDocumentFileResponseDto',
    () =>
      UploadedMilestoneDocumentFileResponseDto.from({
        fileId: 'file-1',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        size: 2048,
        expiresAt: '2026-05-03T00:00:00.000Z',
      }),
  ],
  [
    'UploadedSubmissionFileResponseDto',
    () =>
      UploadedSubmissionFileResponseDto.from({
        fileId: 'file-2',
        fileName: 'archive.zip',
        contentType: 'application/zip',
        size: 4096,
        expiresAt: '2026-05-04T00:00:00.000Z',
      }),
  ],
];
describe('programs response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});
