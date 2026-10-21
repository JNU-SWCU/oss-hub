export interface PublicProgramNavigationResponse {
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly submissionType: 'FILE' | 'TEXT' | null;
    readonly submissionItemCount: number;
  }[];
}

export interface ProgramNavigationMilestone {
  readonly milestoneId: string;
  readonly title: string;

  readonly submissionEnabled: boolean;
}
