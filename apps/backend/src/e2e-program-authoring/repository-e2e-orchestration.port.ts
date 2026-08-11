export type RepositoryOutboxRunResult =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'CONSUMED' }
  | { readonly kind: 'FAILED' };

export type RepositoryWorkerRunResult =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'SUCCEEDED' }
  | { readonly kind: 'FAILED_RETRYABLE' | 'FAILED_FINAL' };

export interface RepositoryE2eOrchestrationPort {
  consumeNext(workerId: string, now: Date): Promise<RepositoryOutboxRunResult>;
  runNext(workerId: string, now: Date): Promise<RepositoryWorkerRunResult>;
}

export const REPOSITORY_E2E_ORCHESTRATION_PORT = Symbol(
  'REPOSITORY_E2E_ORCHESTRATION_PORT',
);
