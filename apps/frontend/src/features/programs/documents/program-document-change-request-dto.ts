export type ProgramDocumentChangeRequestScope =
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'TEAM'; readonly teamId: string };

export interface ProgramDocumentChangeRequestTargets {
  readonly submitted: number;
  readonly changesRequested: number;
  readonly approved: number;
  readonly rejected: number;
  readonly version: string;
}

export interface ProgramDocumentChangeRequestInput {
  readonly scope: ProgramDocumentChangeRequestScope;
  readonly includeFinalDecisions: boolean;
  readonly comment: string;
  readonly resubmissionDueAt: string;
  readonly expectedVersion: string;
}
