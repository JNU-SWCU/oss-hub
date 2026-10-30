import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
  type CollectionMonthlyContributionWindow,
} from '../gateway/collection-discovery.client';
import {
  type CollectionActivityUserRow,
  type CollectionBackfillSnapshotRow,
  CollectionUserActivityRepository,
} from '../repository/collection-user-activity.repository';

const ASIA_SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const MIN_BACKFILL_YEAR = 2026;
const MIN_REMAINING_POINTS = 500;
const MONTHS_PER_YEAR = 12;

export interface CollectionSnapshotBackfillResult {
  readonly observedUserCount: number;

  readonly requestCount: number;

  readonly writtenRowCount: number;

  readonly skippedExistingCount: number;

  readonly skippedStaleCount: number;

  readonly failedUserCount: number;

  readonly stoppedForBudget: boolean;
}

interface UserBackfillOutcome {
  readonly writtenRowCount: number;
  readonly skippedExistingCount: number;
  readonly skippedStaleCount: number;
  readonly stoppedForBudget: boolean;
}

const seoulYearOf = (instant: Date): number =>
  new Date(instant.getTime() + ASIA_SEOUL_OFFSET_MS).getUTCFullYear();

const seoulMonthOf = (instant: Date): number =>
  new Date(instant.getTime() + ASIA_SEOUL_OFFSET_MS).getUTCMonth() + 1;

const seoulMonthStart = (year: number, month: number): Date =>
  new Date(Date.UTC(year, month - 1, 1) - ASIA_SEOUL_OFFSET_MS);

const monthEndDate = (year: number, month: number): Date =>
  new Date(Date.UTC(year, month, 0));

const monthAlias = (month: number): string =>
  `m${month.toString().padStart(2, '0')}`;

const monthOfAlias = (alias: string): number => Number(alias.slice(1));

const backfillMonths = (year: number, startedAt: Date): number[] => {
  const lastMonth =
    seoulYearOf(startedAt) === year
      ? seoulMonthOf(startedAt) - 1
      : MONTHS_PER_YEAR;
  return Array.from({ length: lastMonth }, (_unused, index) => index + 1);
};

@Injectable()
export class CollectionSnapshotBackfillService {
  private readonly logger = new Logger(CollectionSnapshotBackfillService.name);
  private readonly inFlightRuns = new Map<
    number,
    Promise<CollectionSnapshotBackfillResult>
  >();

  constructor(
    private readonly repository: CollectionUserActivityRepository,
    private readonly discoveryClient: CollectionDiscoveryClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  assertSupportedYear(year: number): void {
    const currentYear = seoulYearOf(this.now());
    if (
      !Number.isInteger(year) ||
      year < MIN_BACKFILL_YEAR ||
      year > currentYear
    ) {
      throw new BadRequestException(
        `year must be an integer between ${MIN_BACKFILL_YEAR} and ${currentYear}`,
      );
    }
  }

  async assertReady(year: number): Promise<void> {
    if (!(await this.repository.hasAnySweepSnapshot(year))) {
      throw new ConflictException(
        `snapshot backfill for ${year} needs at least one sweep snapshot first`,
      );
    }
  }

  run(year: number): Promise<CollectionSnapshotBackfillResult> {
    const inFlight = this.inFlightRuns.get(year);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const flight = this.runBackfill(year).finally(() => {
      this.inFlightRuns.delete(year);
    });
    this.inFlightRuns.set(year, flight);
    return flight;
  }

  private async runBackfill(
    year: number,
  ): Promise<CollectionSnapshotBackfillResult> {
    this.assertSupportedYear(year);
    const startedAt = this.now();

    await this.assertReady(year);

    const months = backfillMonths(year, startedAt);
    const users = await this.repository.listActiveUsers();

    let processedUserCount = 0;
    let requestCount = 0;
    let writtenRowCount = 0;
    let skippedExistingCount = 0;
    let skippedStaleCount = 0;
    let failedUserCount = 0;
    let stoppedForBudget = false;

    for (const user of users) {
      if (stoppedForBudget) break;
      processedUserCount += 1;

      try {
        const outcome = await this.backfillUser(
          user,
          year,
          months,
          startedAt,
          () => {
            requestCount += 1;
          },
        );
        writtenRowCount += outcome.writtenRowCount;
        skippedExistingCount += outcome.skippedExistingCount;
        skippedStaleCount += outcome.skippedStaleCount;
        stoppedForBudget = outcome.stoppedForBudget;
      } catch (error) {
        failedUserCount += 1;

        this.logger.warn({
          event: 'collection.snapshot_backfill.user_failed',
          year,
          kind:
            error instanceof CollectionDiscoveryClientError
              ? error.kind
              : 'UNKNOWN',
        });
      }
    }

    return {
      observedUserCount: processedUserCount,
      requestCount,
      writtenRowCount,
      skippedExistingCount,
      skippedStaleCount,
      failedUserCount,
      stoppedForBudget,
    };
  }

  private async backfillUser(
    user: CollectionActivityUserRow,
    year: number,
    months: readonly number[],
    startedAt: Date,
    countRequest: () => void,
  ): Promise<UserBackfillOutcome> {
    const latestSweep = await this.repository.findLatestSweepSnapshot(
      user.githubId,
      year,
    );
    if (latestSweep === null) {
      return {
        writtenRowCount: 0,
        skippedExistingCount: 0,
        skippedStaleCount: 1,
        stoppedForBudget: false,
      };
    }

    const existingDates = new Set(
      (await this.repository.findSnapshotDates(user.githubId, year)).map(
        (date) => date.getTime(),
      ),
    );
    const missingMonths = months.filter(
      (month) => !existingDates.has(monthEndDate(year, month).getTime()),
    );
    const skippedExistingCount = months.length - missingMonths.length;
    if (missingMonths.length === 0) {
      return {
        writtenRowCount: 0,
        skippedExistingCount,
        skippedStaleCount: 0,
        stoppedForBudget: false,
      };
    }

    const windows: CollectionMonthlyContributionWindow[] = missingMonths.map(
      (month) => ({
        alias: monthAlias(month),
        from: seoulMonthStart(year, 1).toISOString(),
        to: seoulMonthStart(year, month + 1).toISOString(),
      }),
    );
    countRequest();
    const observed =
      await this.discoveryClient.fetchUserMonthlyContributionCounts(
        user.nickname,
        windows,
      );

    const rows: CollectionBackfillSnapshotRow[] = observed.months.map(
      (month) => ({
        githubId: user.githubId,
        snapshotDate: monthEndDate(year, monthOfAlias(month.alias)),
        year,
        githubLogin: user.nickname,
        commitCount: month.commitCount,
        pullRequestCount: month.pullRequestCount,
        issueCount: month.issueCount,
        repositoryCount: month.repositoryCount,
        starCount: latestSweep.starCount,
        observedAt: startedAt,
      }),
    );

    return {
      writtenRowCount: await this.repository.insertBackfillSnapshots(rows),
      skippedExistingCount,
      skippedStaleCount: 0,
      stoppedForBudget: observed.remaining < MIN_REMAINING_POINTS,
    };
  }
}
