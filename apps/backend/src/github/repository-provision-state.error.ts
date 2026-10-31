export class RepositoryProvisionFailure extends Error {
  override readonly name = 'RepositoryProvisionFailure';

  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAt: Date | null = null,
  ) {
    super(code);
  }

  static final(code: string): RepositoryProvisionFailure {
    return new RepositoryProvisionFailure(code, false);
  }
}

export class RepositoryProvisionLeaseLostError extends Error {
  override readonly name = 'RepositoryProvisionLeaseLostError';
}

export class RepositoryProvisionSupersededError extends Error {
  override readonly name = 'RepositoryProvisionSupersededError';

  constructor(readonly staleRequestId: string) {
    super('Repository provision request was superseded');
  }
}

export class GithubRepositoryClaimConflictError extends Error {
  override readonly name = 'GithubRepositoryClaimConflictError';
}
export class RepositoryProvisionStateError extends Error {
  override readonly name = 'RepositoryProvisionStateError';
}
