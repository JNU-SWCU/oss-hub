import { Injectable } from '@nestjs/common';
import {
  RANKING_NOTICE,
  RANKING_PERIODS,
  type RankingEntry,
  type RankingMetrics,
  type RankingPage,
  type RankingPeriod,
} from './domain/ranking';
import {
  RankingRepository,
  type RankingObservation,
} from './ranking.repository';

const RANKING_CACHE_TTL_MS = 60_000;

interface ParsedEvent {
  readonly repositoryId: string;
  readonly occurredAt: Date;
  readonly metrics: RankingMetrics;
}

interface CanonicalIdentity {
  readonly login: string;
  readonly runId: string;
  readonly runStartedAt: Date;
}

interface CachedRanking {
  readonly entries: readonly RankingEntry[];
  readonly expiresAt: number;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNonNegativeInteger(record: JsonRecord, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function readRepositoryId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
}

function parseOccurredAt(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const occurredAt = new Date(value);
  return Number.isNaN(occurredAt.getTime()) ? null : occurredAt;
}

function parseMetrics(
  eventType: string,
  payload: JsonRecord,
): RankingMetrics | null {
  if (eventType === 'PushEvent') {
    return {
      commitCount: readNonNegativeInteger(payload, 'size'),
      prCount: 0,
      starCount: 0,
    };
  }
  if (eventType === 'PullRequestEvent' && payload.action === 'opened') {
    return { commitCount: 0, prCount: 1, starCount: 0 };
  }
  if (eventType === 'WatchEvent' && payload.action === 'started') {
    return { commitCount: 0, prCount: 0, starCount: 1 };
  }
  return null;
}

function parseEvent(payload: unknown): ParsedEvent | null {
  if (!isRecord(payload)) {
    return null;
  }
  const eventType = readString(payload, 'type');
  const occurredAt = parseOccurredAt(readString(payload, 'created_at'));
  const repository = payload.repo;
  const eventPayload = payload.payload;
  if (
    !eventType ||
    !occurredAt ||
    !isRecord(repository) ||
    !isRecord(eventPayload)
  ) {
    return null;
  }
  const repositoryId = readRepositoryId(repository.id);
  const metrics = parseMetrics(eventType, eventPayload);
  return repositoryId && metrics ? { repositoryId, occurredAt, metrics } : null;
}

function isWithinPeriod(
  occurredAt: Date,
  period: RankingPeriod,
  currentYear: number,
): boolean {
  return (
    period === RANKING_PERIODS.ALL ||
    occurredAt.getUTCFullYear() === currentYear
  );
}

function addMetrics(
  current: RankingMetrics,
  addition: RankingMetrics,
): RankingMetrics {
  return {
    commitCount: current.commitCount + addition.commitCount,
    prCount: current.prCount + addition.prCount,
    starCount: current.starCount + addition.starCount,
  };
}

function emptyMetrics(): RankingMetrics {
  return { commitCount: 0, prCount: 0, starCount: 0 };
}

function isNewerIdentity(
  candidate: RankingObservation,
  current: CanonicalIdentity | undefined,
): boolean {
  if (!current) {
    return true;
  }
  const timeDifference =
    candidate.runStartedAt.getTime() - current.runStartedAt.getTime();
  return (
    timeDifference > 0 ||
    (timeDifference === 0 && candidate.runId > current.runId)
  );
}

@Injectable()
export class RankingService {
  private readonly cache = new Map<string, CachedRanking>();
  private readonly inFlightBuilds = new Map<
    string,
    Promise<readonly RankingEntry[]>
  >();

  constructor(private readonly repository: RankingRepository) {}

  async findPage(
    period: RankingPeriod,
    page: number,
    pageSize: number,
    now: Date = new Date(),
  ): Promise<RankingPage> {
    const entries = await this.findEntries(period, now);
    const start = (page - 1) * pageSize;
    return {
      notice: RANKING_NOTICE,
      period,
      items: entries.slice(start, start + pageSize),
      page,
      pageSize,
      total: entries.length,
    };
  }

  private async findEntries(
    period: RankingPeriod,
    now: Date,
  ): Promise<readonly RankingEntry[]> {
    const currentYear = now.getUTCFullYear();
    const cacheKey =
      period === RANKING_PERIODS.ALL ? period : `${period}:${currentYear}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entries;
    }

    const existingBuild = this.inFlightBuilds.get(cacheKey);
    if (existingBuild) {
      return existingBuild;
    }

    const build = this.buildEntries(period, currentYear)
      .then((entries) => {
        this.cache.set(cacheKey, {
          entries,
          expiresAt: Date.now() + RANKING_CACHE_TTL_MS,
        });
        return entries;
      })
      .finally(() => this.inFlightBuilds.delete(cacheKey));
    this.inFlightBuilds.set(cacheKey, build);
    return build;
  }

  private async buildEntries(
    period: RankingPeriod,
    currentYear: number,
  ): Promise<readonly RankingEntry[]> {
    const repositoryIds = new Set<string>();
    for await (const batch of this.repository.findPlatformRepositoryIdBatches()) {
      for (const repositoryId of batch) {
        repositoryIds.add(repositoryId);
      }
    }
    const metricsByGithubId = new Map<string, RankingMetrics>();
    const identitiesByGithubId = new Map<string, CanonicalIdentity>();
    const fetchedAtOrAfter =
      period === RANKING_PERIODS.THIS_YEAR
        ? new Date(Date.UTC(currentYear, 0, 1))
        : undefined;
    let previousSourceId: string | undefined;

    for await (const batch of this.repository.findObservationBatches(
      fetchedAtOrAfter,
    )) {
      for (const observation of batch) {
        const currentIdentity = identitiesByGithubId.get(
          observation.targetGithubId,
        );
        if (isNewerIdentity(observation, currentIdentity)) {
          identitiesByGithubId.set(observation.targetGithubId, {
            login: observation.targetLogin,
            runId: observation.runId,
            runStartedAt: observation.runStartedAt,
          });
        }

        if (observation.sourceId === previousSourceId) {
          continue;
        }
        previousSourceId = observation.sourceId;
        const event = parseEvent(observation.payload);
        if (
          !event ||
          !repositoryIds.has(event.repositoryId) ||
          !isWithinPeriod(event.occurredAt, period, currentYear)
        ) {
          continue;
        }
        metricsByGithubId.set(
          observation.targetGithubId,
          addMetrics(
            metricsByGithubId.get(observation.targetGithubId) ?? emptyMetrics(),
            event.metrics,
          ),
        );
      }
    }

    return this.toEntries(metricsByGithubId, identitiesByGithubId);
  }

  private toEntries(
    metricsByGithubId: ReadonlyMap<string, RankingMetrics>,
    identitiesByGithubId: ReadonlyMap<string, CanonicalIdentity>,
  ): RankingEntry[] {
    return [...metricsByGithubId.entries()]
      .map(([githubId, metrics]) => ({
        githubId,
        rank: 0,
        displayName: identitiesByGithubId.get(githubId)?.login ?? githubId,
        githubLogin: identitiesByGithubId.get(githubId)?.login ?? githubId,
        ...metrics,
        total: metrics.commitCount + metrics.prCount + metrics.starCount,
      }))
      .filter((entry) => entry.total > 0)
      .sort(
        (left, right) =>
          right.total - left.total ||
          right.commitCount - left.commitCount ||
          right.prCount - left.prCount ||
          right.starCount - left.starCount ||
          left.githubLogin.localeCompare(right.githubLogin) ||
          left.githubId.localeCompare(right.githubId),
      )
      .map((entry, index) => ({
        rank: index + 1,
        displayName: entry.displayName,
        githubLogin: entry.githubLogin,
        commitCount: entry.commitCount,
        prCount: entry.prCount,
        starCount: entry.starCount,
        total: entry.total,
      }));
  }
}
