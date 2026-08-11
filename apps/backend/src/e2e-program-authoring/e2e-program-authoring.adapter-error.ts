export class E2eAdapterError extends Error {
  override readonly name = 'E2eAdapterError';

  constructor(readonly status: number) {
    super('E2E adapter request was rejected.');
  }
}
