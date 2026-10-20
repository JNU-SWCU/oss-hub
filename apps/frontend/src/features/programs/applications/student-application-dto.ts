export interface StudentApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  readonly teamId: string | null;
  readonly answers: {
    readonly applicantName: string;
    readonly title: string;
  };
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly isRepositoryPublicationPlanned: boolean;

  readonly rejectionReason: string | null;

  readonly isManager: boolean;
  readonly canManage: boolean;

  readonly canEdit: boolean;

  readonly canCancel: boolean;
}

export interface UpdateStudentApplicationInput {
  readonly answers: { readonly title: string };
  readonly applicationTemplateVersion: number;
}
