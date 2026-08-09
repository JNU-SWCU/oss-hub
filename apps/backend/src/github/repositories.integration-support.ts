import type {
  ClaimedProvisionEvent,
  ClaimProvisionEventInput,
  ProvisionJobReference,
  RepositoriesRepository,
  RepositoriesTransactionStore,
  RepositoryPublishTarget,
} from './repository/repositories.repository';

/**
 * todo 20 — admin-access.integration-support.ts의 barrier 패턴을 repository 수동 공개
 * CAS 경합에 그대로 옮긴다. 두 트랜잭션이 실제로 겹쳐 Postgres 행 잠금이 걸리도록,
 * CAS 직전에 barrier로 도착을 맞춘 뒤 함께 진행시킨다.
 */
class TwoPartyBarrier {
  private arrivals = 0;
  private release: (() => void) | null = null;
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async wait(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals === 2) {
      this.release?.();
    }
    await this.released;
  }
}

class BarrierRepositoriesTransactionStore implements RepositoriesTransactionStore {
  constructor(
    private readonly store: RepositoriesTransactionStore,
    private readonly barrier: TwoPartyBarrier,
  ) {}

  get auditLogWriter() {
    return this.store.auditLogWriter;
  }

  findPublishTarget(
    repositoryId: string,
  ): Promise<RepositoryPublishTarget | null> {
    return this.store.findPublishTarget(repositoryId);
  }

  async publishRepositoryIfPrivate(
    repositoryId: string,
    githubRepositoryId: bigint,
    now: Date,
  ): Promise<boolean> {
    await this.barrier.wait();
    return this.store.publishRepositoryIfPrivate(
      repositoryId,
      githubRepositoryId,
      now,
    );
  }

  claimProvisionEvent(
    input: ClaimProvisionEventInput,
  ): Promise<ClaimedProvisionEvent | null> {
    return this.store.claimProvisionEvent(input);
  }

  upsertProvisionJob(
    applicationId: string,
    now: Date,
  ): Promise<ProvisionJobReference> {
    return this.store.upsertProvisionJob(applicationId, now);
  }

  completeProvisionEvent(
    eventId: string,
    workerId: string,
    now: Date,
  ): Promise<void> {
    return this.store.completeProvisionEvent(eventId, workerId, now);
  }

  failProvisionEvent(eventId: string, workerId: string): Promise<void> {
    return this.store.failProvisionEvent(eventId, workerId);
  }
}

export class BarrierRepositoriesRepository {
  private readonly barrier = new TwoPartyBarrier();

  constructor(
    private readonly repository: Pick<
      RepositoriesRepository,
      'findPublishTarget' | 'listOwnedProvisionJobs' | 'withTransaction'
    >,
  ) {}

  withTransaction<T>(
    operation: (store: RepositoriesTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new BarrierRepositoriesTransactionStore(store, this.barrier)),
    );
  }

  findPublishTarget(
    repositoryId: string,
  ): Promise<RepositoryPublishTarget | null> {
    return this.repository.findPublishTarget(repositoryId);
  }

  listOwnedProvisionJobs(
    githubId: bigint,
  ): ReturnType<RepositoriesRepository['listOwnedProvisionJobs']> {
    return this.repository.listOwnedProvisionJobs(githubId);
  }
}
