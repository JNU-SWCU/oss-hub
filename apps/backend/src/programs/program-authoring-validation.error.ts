export type ProgramAuthoringValidationIssue = {
  readonly path: string;
  readonly code: string;
};

export class ProgramAuthoringValidationError extends Error {
  override readonly name = 'ProgramAuthoringValidationError';

  constructor(readonly issues: readonly ProgramAuthoringValidationIssue[]) {
    super('Program authoring request is invalid.');
  }
}
