export class RepositoryEventAlreadyExistsError extends Error {
  override readonly name = 'RepositoryEventAlreadyExistsError';
}

export class ApplicationDuplicateError extends Error {
  override readonly name = 'ApplicationDuplicateError';
}

export class ApplicationTeamMembershipConflictError extends Error {
  override readonly name = 'ApplicationTeamMembershipConflictError';
}

export class ApplicationJoinCodeDigestConflictError extends Error {
  override readonly name = 'ApplicationJoinCodeDigestConflictError';
}

export class ApplicationPreparationConflictError extends Error {}
