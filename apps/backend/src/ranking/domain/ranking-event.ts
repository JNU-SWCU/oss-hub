import {
  RANKING_PERIODS,
  type RankingMetrics,
  type RankingPeriod,
} from './ranking';
import type { RankingObservation } from '../ranking.repository';

const ASIA_SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface ParsedRankingEvent {
  readonly type: string;
  readonly repositoryId: string;
  readonly occurredAt: Date;
  readonly metrics: RankingMetrics;
}

export interface CanonicalIdentity {
  readonly login: string;
  readonly runId: string;
  readonly runStartedAt: Date;
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

export function parseRankingEvent(payload: unknown): ParsedRankingEvent | null {
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
  return repositoryId && metrics
    ? { type: eventType, repositoryId, occurredAt, metrics }
    : null;
}

export function rankingYearInAsiaSeoul(date: Date): number {
  return new Date(date.getTime() + ASIA_SEOUL_OFFSET_MS).getUTCFullYear();
}

export function rankingYearStartInAsiaSeoul(year: number): Date {
  return new Date(Date.UTC(year, 0, 1) - ASIA_SEOUL_OFFSET_MS);
}

export function isWithinRankingPeriod(
  occurredAt: Date,
  period: RankingPeriod,
  currentYear: number,
): boolean {
  return (
    period === RANKING_PERIODS.ALL ||
    rankingYearInAsiaSeoul(occurredAt) === currentYear
  );
}

export function addRankingMetrics(
  current: RankingMetrics,
  addition: RankingMetrics,
): RankingMetrics {
  return {
    commitCount: current.commitCount + addition.commitCount,
    prCount: current.prCount + addition.prCount,
    starCount: current.starCount + addition.starCount,
  };
}

export function emptyRankingMetrics(): RankingMetrics {
  return { commitCount: 0, prCount: 0, starCount: 0 };
}

export function isNewerIdentity(
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
