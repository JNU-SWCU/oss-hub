export class ProgramMailStoredResultError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Invalid stored program mail result: ${idempotencyKey}`);
    this.name = 'ProgramMailStoredResultError';
  }
}
