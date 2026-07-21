import { Injectable } from '@nestjs/common';
import {
  RANKING_NOTICE,
  RANKING_PERIODS,
  type RankingEntry,
  type RankingMetrics,
  type RankingPage,
  type RankingPeriod,
} from './domain/ranking';
import { RankingRepository } from './ranking.repository';

interface ParsedEvent {
  readonly repositoryId: string;
  readonly occurredAt: Date;
  readonly metrics: RankingMetrics;
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

@Injectable()
export class RankingService {
  constructor(private readonly repository: RankingRepository) {}

  async findPage(
    period: RankingPeriod,
    page: number,
    pageSize: number,
    now: Date = new Date(),
  ): Promise<RankingPage> {
    const source = await this.repository.findSourceData();
    const platformRepositoryIds = new Set(source.platformRepositoryIds);
    const deduplicatedEventIds = new Set<string>();
    const metricsByLogin = new Map<string, RankingMetrics>();
    const currentYear = now.getUTCFullYear();

    for (const observation of source.observations) {
      if (deduplicatedEventIds.has(observation.sourceId)) {
        continue;
      }
      const event = parseEvent(observation.payload);
      if (
        !event ||
        !platformRepositoryIds.has(event.repositoryId) ||
        !isWithinPeriod(event.occurredAt, period, currentYear)
      ) {
        continue;
      }
      deduplicatedEventIds.add(observation.sourceId);
      metricsByLogin.set(
        observation.targetLogin,
        addMetrics(
          metricsByLogin.get(observation.targetLogin) ?? emptyMetrics(),
          event.metrics,
        ),
      );
    }

    const entries = this.toEntries(metricsByLogin);
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

  private toEntries(
    metricsByLogin: ReadonlyMap<string, RankingMetrics>,
  ): RankingEntry[] {
    return [...metricsByLogin.entries()]
      .map(([githubLogin, metrics]) => ({
        rank: 0,
        displayName: githubLogin,
        githubLogin,
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
          left.githubLogin.localeCompare(right.githubLogin),
      )
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }
}
