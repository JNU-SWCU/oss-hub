import { Injectable, Logger } from '@nestjs/common';

import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
} from '../gateway/collection-discovery.client';
import {
  type CollectionActivityUserRow,
  type CollectionUserActivityObservationInput,
  CollectionUserActivityRepository,
} from '../repository/collection-user-activity.repository';

const ASIA_SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface CollectionUserActivitySweepResult {
  readonly observedUserCount: number;

  readonly upsertedRowCount: number;

  readonly skippedPastYearCount: number;

  readonly failedUserCount: number;
}

const seoulYearStart = (year: number): Date =>
  new Date(Date.UTC(year, 0, 1) - ASIA_SEOUL_OFFSET_MS);

const seoulYearOf = (instant: Date): number =>
  new Date(instant.getTime() + ASIA_SEOUL_OFFSET_MS).getUTCFullYear();

@Injectable()
export class CollectionUserActivityService {
  private readonly logger = new Logger(CollectionUserActivityService.name);
  private inFlightRun: Promise<CollectionUserActivitySweepResult> | null = null;

  constructor(
    private readonly repository: CollectionUserActivityRepository,
    private readonly discoveryClient: CollectionDiscoveryClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  run(years?: readonly number[]): Promise<CollectionUserActivitySweepResult> {
    if (this.inFlightRun !== null) {
      return this.inFlightRun;
    }

    const flight = this.runSweep(years).finally(() => {
      this.inFlightRun = null;
    });
    this.inFlightRun = flight;
    return flight;
  }

  private async runSweep(
    years?: readonly number[],
  ): Promise<CollectionUserActivitySweepResult> {
    const startedAt = this.now();
    const currentYear = seoulYearOf(startedAt);
    const targetYears = years === undefined ? [currentYear] : [...years];

    const users = await this.repository.listActiveUsers();

    let upsertedRowCount = 0;
    let skippedPastYearCount = 0;
    let failedUserCount = 0;

    for (const user of users) {
      let userFailed = false;
      for (const year of targetYears) {
        if (
          year !== currentYear &&
          (await this.repository.hasObservation(user.githubId, year))
        ) {
          skippedPastYearCount += 1;
          continue;
        }

        try {
          await this.observe(user, year, currentYear, startedAt);
          upsertedRowCount += 1;
        } catch (error) {
          userFailed = true;

          this.logger.warn({
            event: 'collection.user_activity.user_failed',
            year,
            kind:
              error instanceof CollectionDiscoveryClientError
                ? error.kind
                : 'UNKNOWN',
          });
        }
      }
      if (userFailed) failedUserCount += 1;
    }

    return {
      observedUserCount: users.length,
      upsertedRowCount,
      skippedPastYearCount,
      failedUserCount,
    };
  }

  private async observe(
    user: CollectionActivityUserRow,
    year: number,
    currentYear: number,
    startedAt: Date,
  ): Promise<void> {
    const from = seoulYearStart(year);

    const to = year === currentYear ? startedAt : seoulYearStart(year + 1);

    const metrics = await this.discoveryClient.fetchUserActivityMetrics(
      user.nickname,
      from.toISOString(),
      to.toISOString(),
    );

    const observedAt = this.now();

    const observation: CollectionUserActivityObservationInput = {
      githubId: user.githubId,
      year,
      githubLogin: user.nickname,
      commitCount: metrics.commitCount,
      pullRequestCount: metrics.pullRequestCount,
      issueCount: metrics.issueCount,
      repositoryCount: metrics.repositoryCount,
      starCount: metrics.starCount,
      observedAt,
    };
    await this.repository.upsertObservation(observation);
  }
}
