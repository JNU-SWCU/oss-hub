export class RepositoryNotFoundError extends Error {
  override readonly name = 'RepositoryNotFoundError';
}

export class RepositoryNameInputError extends Error {
  override readonly name = 'RepositoryNameInputError';

  constructor() {
    super('Repository name requires stable ASCII identifiers');
  }
}
