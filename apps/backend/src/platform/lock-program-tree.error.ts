export class LockOrderError extends Error {
  override readonly name = 'LockOrderError';
  constructor() {
    super('Invalid program tree lock order.');
  }
}
