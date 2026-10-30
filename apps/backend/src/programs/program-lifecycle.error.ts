export class ProgramPurgeDeletedScopeMismatchError extends Error {
  constructor() {
    super('Program purge deleted counts differ from its confirmed scope.');
    this.name = 'ProgramPurgeDeletedScopeMismatchError';
  }
}
