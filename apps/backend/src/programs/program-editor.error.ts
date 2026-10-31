export class ProgramMilestoneEditValidationError extends Error {
  override readonly name = 'ProgramMilestoneEditValidationError';

  constructor(
    readonly field: string,
    readonly code: string,
  ) {
    super('Program milestone edit documents are invalid.');
  }
}

export class ProgramEditorMilestoneEditRaceError extends Error {
  override readonly name = 'ProgramEditorMilestoneEditRaceError';

  constructor() {
    super('Locked upload was unavailable during milestone edit.');
  }
}
