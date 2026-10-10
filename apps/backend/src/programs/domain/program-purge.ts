export type ProgramPurgeDeletedCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly teamMembers: number;
  readonly teamInvitations: number;
  readonly boardPosts: number;
  readonly boardComments: number;
  readonly submissions: number;
  readonly submissionRevisions: number;
  readonly reviews: number;
  readonly submissionFiles: number;
  readonly milestones: number;
  readonly milestoneDocuments: number;
  readonly milestoneDocumentSubmissions: number;
  readonly milestoneDocumentSubmissionHistories: number;
  readonly milestoneDocumentReviewHistories: number;
  readonly milestoneDocumentTemplateFiles: number;
  readonly programAuthoringUploads: number;
  readonly programCreateRequests: number;
  readonly repositoryProvisionJobs: number;
  readonly githubRepositoriesDetached: number;
  readonly outboxEvents: number;
  readonly notifications: number;
  readonly programPurgeFileTombstones: number;
};

export type ProgramPurgeResult = {
  readonly id: string;
  readonly deleted: true;
  readonly deletedCounts: ProgramPurgeDeletedCounts;
};
