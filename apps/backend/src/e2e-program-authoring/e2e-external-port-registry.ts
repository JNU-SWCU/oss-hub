import { createHash } from 'node:crypto';

export const E2E_EXTERNAL_FAILURE_OPERATIONS = {
  GITHUB_CREATE: 'GITHUB_CREATE',
  GITHUB_FIND: 'GITHUB_FIND',
  GITHUB_FIND_PUBLIC: 'GITHUB_FIND_PUBLIC',
  GITHUB_COLLABORATOR: 'GITHUB_COLLABORATOR',
  GITHUB_PUBLISH: 'GITHUB_PUBLISH',
  SMTP_SEND: 'SMTP_SEND',
  STORAGE_PUT: 'STORAGE_PUT',
  STORAGE_GET: 'STORAGE_GET',
  STORAGE_DELETE: 'STORAGE_DELETE',
  PRISMA_TRANSACTION: 'PRISMA_TRANSACTION',
} as const;

export type E2eExternalFailureOperation =
  (typeof E2E_EXTERNAL_FAILURE_OPERATIONS)[keyof typeof E2E_EXTERNAL_FAILURE_OPERATIONS];

export type E2eExternalCapture = {
  readonly mail: {
    readonly envelopeCount: number;
    readonly contentHashes: readonly string[];
  };
  readonly storage: {
    readonly objectCount: number;
    readonly objectKeys: readonly string[];
    readonly contentHashes: readonly string[];
  };
};

export class E2eExternalPortFailure extends Error {
  override readonly name = 'E2eExternalPortFailure';

  constructor(readonly operation: E2eExternalFailureOperation) {
    super(`E2E external operation failed: ${operation}`);
  }
}

export class E2eExternalPortFault extends Error {
  override readonly name = 'E2eExternalPortFault';

  constructor() {
    super('E2E Prisma transaction was faulted.');
  }
}

export class E2eExternalPortRegistry {
  private readonly failures = new Map<E2eExternalFailureOperation, number>();
  private readonly mailContentHashes: string[] = [];
  private readonly storageContentHashes = new Map<string, string>();

  configure(operation: E2eExternalFailureOperation, attempts: number): void {
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) {
      throw new RangeError(
        'E2E external failure attempts must be between 1 and 3.',
      );
    }
    this.failures.set(operation, attempts);
  }

  consume(operation: E2eExternalFailureOperation): boolean {
    const remaining = this.failures.get(operation) ?? 0;
    if (remaining === 0) return false;
    this.failures.set(operation, remaining - 1);
    return true;
  }

  remaining(operation: E2eExternalFailureOperation): number {
    return this.failures.get(operation) ?? 0;
  }

  recordMail(subject: string, body: string): void {
    this.mailContentHashes.push(hash(`${subject}\n${body}`));
  }

  recordStorage(objectKey: string, body: Buffer): void {
    this.storageContentHashes.set(objectKey, hash(body));
  }

  forgetStorage(objectKey: string): void {
    this.storageContentHashes.delete(objectKey);
  }

  capture(): E2eExternalCapture {
    return {
      mail: {
        envelopeCount: this.mailContentHashes.length,
        contentHashes: [...this.mailContentHashes].sort(),
      },
      storage: {
        objectCount: this.storageContentHashes.size,
        objectKeys: [...this.storageContentHashes.keys()].sort(),
        contentHashes: [...this.storageContentHashes.values()].sort(),
      },
    };
  }

  reset(): void {
    this.resetFailures();
    this.mailContentHashes.length = 0;
    this.storageContentHashes.clear();
  }

  resetFailures(): void {
    this.failures.clear();
  }
}

function hash(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}
