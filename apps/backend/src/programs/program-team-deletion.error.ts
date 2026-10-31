export class TeamDeletedScopeMismatchError extends Error {
  constructor() {
    super('Team deletion deleted counts differ from its confirmed scope.');
    this.name = 'TeamDeletedScopeMismatchError';
  }
}
