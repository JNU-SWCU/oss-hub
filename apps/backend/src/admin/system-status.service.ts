import { Inject, Injectable } from '@nestjs/common';
import { COLLECTION_STALE_AFTER_MS } from '../github/collection-app.config';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import {
  SystemStatusRepository,
  type AdminChangeEventDto,
  type BulkRemovalEventDto,
  type MailStatusDto,
  type ProvisioningStatusDto,
} from './system-status.repository';

type CollectionHealthResult = 'EMPTY' | 'NORMAL' | 'DELAYED';

type CurrentRunStatusResult = 'IDLE' | 'PROCESSING';

type SystemStatusSafeReasonResult = 'NO_TRACKED_REPOSITORIES' | 'STALE_DATA';

interface CollectionSystemStatusResult {
  readonly health: CollectionHealthResult;
  readonly trackedRepositoryCount: number;
  readonly staleRepositoryCount: number;
  readonly lastSuccessAt: Date | null;
  readonly nextCycleAt: Date | null;
  readonly currentRunStatus: CurrentRunStatusResult;
  readonly safeReason: SystemStatusSafeReasonResult | null;
}

export type SystemStatusAnomalyRule =
  | 'BULK_REMOVAL'
  | 'SELF_ADMIN_CHANGE'
  | 'OFF_HOURS_ADMIN_CHANGE'
  | 'PROVISIONING_FAILED'
  | 'COLLECTION_STALE'
  | 'MAIL_FAILED';

export type SystemStatusAnomalySeverity = 'HIGH' | 'MEDIUM';

interface SystemStatusAnomalyResult {
  readonly rule: SystemStatusAnomalyRule;
  readonly severity: SystemStatusAnomalySeverity;
  readonly count: number;
  readonly target: {
    readonly kind: 'USER';
    readonly id: string;
    readonly login: string | null;
  } | null;
}

interface SystemStatusCollectionRepositoryResult {
  readonly repositoryName: string;
  readonly programName: string | null;
  readonly lastSuccessAt: Date | null;
  readonly stale: boolean;
}

interface SystemStatusExternalCollectionResult {
  readonly trackedRepositoryCount: number;
  readonly lastSuccessAt: Date | null;
}

export interface SystemStatusResult {
  readonly collection: CollectionSystemStatusResult;
  readonly provisioning: ProvisioningStatusDto;
  readonly mail: MailStatusDto;
  readonly anomalies: readonly SystemStatusAnomalyResult[];
  readonly collectionRepositories: readonly SystemStatusCollectionRepositoryResult[];
  readonly externalCollection: SystemStatusExternalCollectionResult;
}

const ANOMALY_WINDOW_MS = 7 * 24 * 60 * 60_000;
const BULK_REMOVAL_WINDOW_MS = 10 * 60_000;
const BULK_REMOVAL_THRESHOLD = 10;
const KST_OFFSET_MS = 9 * 60 * 60_000;
const SEVERITY_ORDER: Record<SystemStatusAnomalySeverity, number> = {
  HIGH: 0,
  MEDIUM: 1,
};

export const SYSTEM_STATUS_CLOCK = Symbol('SYSTEM_STATUS_CLOCK');
export type SystemStatusClock = () => Date;

@Injectable()
export class SystemStatusService {
  constructor(
    private readonly repository: SystemStatusRepository,
    @Inject(SYSTEM_STATUS_CLOCK) private readonly clock: SystemStatusClock,
    private readonly collectionSchedule: CollectionScheduleService,
  ) {}

  async getStatus(): Promise<SystemStatusResult> {
    const now = this.clock();
    const nextCycleAt = this.collectionSchedule.nextScheduledCollectionAt(now);
    const since = new Date(now.getTime() - ANOMALY_WINDOW_MS);
    const [
      repositories,
      running,
      provisioning,
      externalCollection,
      mail,
      removals,
      adminChanges,
    ] = await Promise.all([
      this.repository.getCollectionRepositories(),
      this.repository.hasActiveCollectionRun(now),
      this.repository.getProvisioningStatus(),
      this.repository.getExternalCollectionStatus(),
      this.repository.getMailStatus(since),
      this.repository.findBulkRemovalEvents(since),
      this.repository.findAdminChangeEvents(since),
    ]);
    const collectionRepositories = repositories.map((repository) => ({
      ...repository,
      stale:
        repository.lastSuccessAt !== null &&
        now.getTime() - repository.lastSuccessAt.getTime() >
          COLLECTION_STALE_AFTER_MS,
    }));
    const staleRepositoryCount = collectionRepositories.filter(
      (repository) => repository.stale,
    ).length;
    const lastSuccessAt = collectionRepositories.reduce<Date | null>(
      (latest, repository) =>
        repository.lastSuccessAt !== null &&
        (latest === null || latest < repository.lastSuccessAt)
          ? repository.lastSuccessAt
          : latest,
      null,
    );
    const health: CollectionHealthResult =
      collectionRepositories.length === 0
        ? 'EMPTY'
        : staleRepositoryCount > 0
          ? 'DELAYED'
          : 'NORMAL';
    return {
      collection: {
        health,
        trackedRepositoryCount: collectionRepositories.length,
        staleRepositoryCount,
        lastSuccessAt,
        nextCycleAt,
        currentRunStatus: running ? 'PROCESSING' : 'IDLE',
        safeReason:
          health === 'EMPTY'
            ? 'NO_TRACKED_REPOSITORIES'
            : health === 'DELAYED'
              ? 'STALE_DATA'
              : null,
      },
      provisioning,
      mail,
      anomalies: [
        ...bulkRemovalAnomalies(removals),
        ...adminChangeAnomalies(
          'SELF_ADMIN_CHANGE',
          'HIGH',
          adminChanges.filter((change) => change.actorId === change.userId),
        ),
        ...adminChangeAnomalies(
          'OFF_HOURS_ADMIN_CHANGE',
          'MEDIUM',
          adminChanges.filter((change) => isOffHoursInKorea(change.occurredAt)),
        ),
        ...countAnomaly(
          'PROVISIONING_FAILED',
          'HIGH',
          provisioning.failedFinal,
        ),
        ...countAnomaly('COLLECTION_STALE', 'MEDIUM', staleRepositoryCount),
        ...countAnomaly('MAIL_FAILED', 'MEDIUM', mail.failed7d),
      ].sort(
        (left, right) =>
          SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
      ),
      collectionRepositories,
      externalCollection,
    };
  }
}

function bulkRemovalAnomalies(
  events: readonly BulkRemovalEventDto[],
): SystemStatusAnomalyResult[] {
  const timesByActor = new Map<string, number[]>();
  for (const { actorId, occurredAt } of events) {
    timesByActor.set(actorId, [
      ...(timesByActor.get(actorId) ?? []),
      occurredAt.getTime(),
    ]);
  }
  return [...timesByActor].flatMap(([actorId, unsorted]) => {
    const times = unsorted.sort((left, right) => left - right);
    const window: number[] = [];
    let peak = 0;
    for (const time of times) {
      window.push(time);
      while (time - (window[0] ?? time) >= BULK_REMOVAL_WINDOW_MS) {
        window.shift();
      }
      peak = Math.max(peak, window.length);
    }
    return peak >= BULK_REMOVAL_THRESHOLD
      ? [
          {
            rule: 'BULK_REMOVAL' as const,
            severity: 'HIGH' as const,
            count: peak,
            target: { kind: 'USER' as const, id: actorId, login: null },
          },
        ]
      : [];
  });
}

function adminChangeAnomalies(
  rule: SystemStatusAnomalyRule,
  severity: SystemStatusAnomalySeverity,
  changes: readonly AdminChangeEventDto[],
): SystemStatusAnomalyResult[] {
  const byUser = new Map<string, { login: string; count: number }>();
  for (const { userId, login } of changes) {
    byUser.set(userId, {
      login,
      count: (byUser.get(userId)?.count ?? 0) + 1,
    });
  }
  return [...byUser].map(([id, { login, count }]) => ({
    rule,
    severity,
    count,
    target: { kind: 'USER', id, login },
  }));
}

function countAnomaly(
  rule: SystemStatusAnomalyRule,
  severity: SystemStatusAnomalySeverity,
  count: number,
): SystemStatusAnomalyResult[] {
  return count > 0 ? [{ rule, severity, count, target: null }] : [];
}

function isOffHoursInKorea(at: Date): boolean {
  const korea = new Date(at.getTime() + KST_OFFSET_MS);
  const hour = korea.getUTCHours();
  const day = korea.getUTCDay();
  return day === 0 || day === 6 || hour >= 22 || hour < 7;
}
