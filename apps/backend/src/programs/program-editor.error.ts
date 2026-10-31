export class ProgramEditorMilestoneEditRaceError extends Error {
  override readonly name = 'ProgramEditorMilestoneEditRaceError';

  constructor() {
    super('Locked upload was unavailable during milestone edit.');
  }
}
