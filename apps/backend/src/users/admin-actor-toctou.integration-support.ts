import type {
  AdminAccessActor,
  AdminAccessInsertedRequest,
  AdminAccessPendingDecisionUpdate,
  AdminAccessRepositoryPort,
  AdminAccessRevokedRequestInsert,
  AdminAccessTransactionStore,
  AdminAccessUserDetailRow,
  AdminAccessUserPageRecord,
  AdminAccessUserRow,
  AdminAccessUserUpdate,
} from './admin-access-read.repository';
import {
  type AdminProfileApplyOutcome,
  type AdminProfileLegacyFields,
  type AdminProfileRepositoryPort,
  type AdminProfileTargetRecord,
  type AdminProfileTransactionStore,
  type AdminProfileWriteFields,
} from './admin-profile.repository';
import {
  type AdminAccessFacets,
  type AdminAccessListQuery,
  type AdminAccessLoginHistoryPage,
  type AdminAccessStaffAccessRequestHistoryPage,
} from './admin-access-read-ordering.repository';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
export type ActorReadPause = () => Promise<void>;
class PausingActorReadAccessStore implements AdminAccessTransactionStore {
  constructor(
    private readonly store: AdminAccessTransactionStore,
    private readonly onActorRead: ActorReadPause,
  ) {}
  get auditLogWriter() {
    return this.store.auditLogWriter;
  }
  private locked = false;
  async findActorByGithubId(
    githubId: bigint,
    forUpdate?: boolean,
  ): Promise<AdminAccessActor | null> {
    const actor = await this.store.findActorByGithubId(githubId, forUpdate);
    if (this.locked) {
      await this.onActorRead();
    }
    return actor;
  }
  async lockActiveAdmins(): Promise<number> {
    const count = await this.store.lockActiveAdmins();
    this.locked = true;
    return count;
  }
  findUserForUpdate(userId: string): Promise<AdminAccessUserRow | null> {
    return this.store.findUserForUpdate(userId);
  }
  compareAndSwapAccess(input: AdminAccessUserUpdate): Promise<boolean> {
    return this.store.compareAndSwapAccess(input);
  }
  decidePendingRequest(
    input: AdminAccessPendingDecisionUpdate,
  ): Promise<boolean> {
    return this.store.decidePendingRequest(input);
  }
  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    return this.store.insertRevokedRequest(input);
  }
}
export class PausingActorReadAdminAccessRepository implements AdminAccessRepositoryPort {
  constructor(
    private readonly repository: AdminAccessRepositoryPort,
    private readonly onActorRead: ActorReadPause,
  ) {}
  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new PausingActorReadAccessStore(store, this.onActorRead)),
    );
  }
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return this.repository.findActorByGithubId(githubId);
  }
  list(query: AdminAccessListQuery): Promise<AdminAccessUserPageRecord> {
    return this.repository.list(query);
  }
  facets(query: AdminAccessListQuery): Promise<AdminAccessFacets> {
    return this.repository.facets(query);
  }
  findById(userId: string): Promise<AdminAccessUserDetailRow | null> {
    return this.repository.findById(userId);
  }
  listStaffAccessRequestHistory(
    userId: string,
    page: {
      readonly page: number;
      readonly limit: number;
    },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    return this.repository.listStaffAccessRequestHistory(userId, page);
  }
  listLoginHistory(
    userId: string,
    page: {
      readonly page: number;
      readonly limit: number;
    },
  ): Promise<AdminAccessLoginHistoryPage> {
    return this.repository.listLoginHistory(userId, page);
  }
}
class PausingActorReadProfileStore implements AdminProfileTransactionStore {
  constructor(
    private readonly store: AdminProfileTransactionStore,
    private readonly onActorRead: ActorReadPause,
  ) {}
  get auditLogWriter() {
    return this.store.auditLogWriter;
  }
  lockActiveAdmins(): Promise<void> {
    return this.store.lockActiveAdmins();
  }
  async findActor(githubId: bigint): Promise<AdminAccessActor | null> {
    const actor = await this.store.findActor(githubId);
    await this.onActorRead();
    return actor;
  }
  findTarget(userId: string): Promise<AdminProfileTargetRecord | null> {
    return this.store.findTarget(userId);
  }
  applyProfile(
    userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
    actorId: string,
  ): Promise<AdminProfileApplyOutcome> {
    return this.store.applyProfile(userId, fields, changedFields, actorId);
  }
  applyLegacyFields(
    userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void> {
    return this.store.applyLegacyFields(userId, fields);
  }
}
export class PausingActorReadAdminProfileRepository implements AdminProfileRepositoryPort {
  constructor(
    private readonly repository: AdminProfileRepositoryPort,
    private readonly onActorRead: ActorReadPause,
  ) {}
  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction((store) =>
      operation(new PausingActorReadProfileStore(store, this.onActorRead)),
    );
  }
}

export function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve: () => resolve() };
}

export function backendPid() {
  let capture: (pid: number) => void = () => undefined;
  const pid = new Promise<number>((resolve) => {
    capture = resolve;
  });
  return { pid, capture: (value: number) => capture(value) };
}

export function pidCapturingPrisma(
  prisma: PrismaService,
  capture: (pid: number) => void,
): PrismaService {
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return <T>(
          operation: (transaction: Prisma.TransactionClient) => Promise<T>,
          options?: {
            readonly maxWait?: number;
            readonly timeout?: number;
            readonly isolationLevel?: Prisma.TransactionIsolationLevel;
          },
        ): Promise<T> =>
          prisma.$transaction(
            async (transaction) => {
              const [row] = await transaction.$queryRaw<
                readonly { readonly pid: number }[]
              >`SELECT pg_backend_pid()::int AS pid`;
              if (!row)
                throw new TypeError('Expected PostgreSQL backend identity');
              capture(row.pid);
              return operation(transaction);
            },
            { maxWait: 20000, timeout: 60000, ...options },
          );
      }
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value === 'function') {
        const bound: unknown = value.bind(target);
        return bound;
      }
      return value;
    },
  });
}

export async function waitUntilBlockedBy(
  prisma: PrismaService,
  lock: {
    readonly waiterPid: number;
    readonly blockerPid: number;
    readonly description?: string;
  },
): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<
      readonly { readonly blocked: boolean }[]
    >`
            SELECT ${lock.blockerPid}::int = ANY(pg_blocking_pids(${lock.waiterPid}::int)) AS blocked
        `;
    if (row?.blocked === true) return;
  }
  throw new Error(
    `${lock.description ?? 'Expected PostgreSQL row-lock dependency'}: ${lock.waiterPid} -> ${lock.blockerPid}`,
  );
}
