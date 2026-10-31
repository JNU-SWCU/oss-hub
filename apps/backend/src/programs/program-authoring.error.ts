export class ProgramAuthoringAttachmentRaceError extends Error {
  override readonly name = 'ProgramAuthoringAttachmentRaceError';

  constructor() {
    super('Program authoring uploads changed before attachment.');
  }
}
export class ProgramAuthoringForbiddenError extends Error {
  override readonly name = 'ProgramAuthoringForbiddenError';

  constructor() {
    super('Program authoring requires staff or administrator access.');
  }
}
