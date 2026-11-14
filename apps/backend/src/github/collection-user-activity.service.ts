import { Injectable, Logger } from '@nestjs/common';

import { CollectionDiscoveryClient } from './collection-discovery.client';
import {
  type CollectionActivityUserRow,
  type CollectionUserActivityObservationInput,
  CollectionUserActivityRepository,
} from './repository-provision-job.repository';
import { CollectionDiscoveryClientError } from './collection-discovery.error';

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

  async observePrivate(
    accessToken: string,
    githubId: bigint,
    githubLogin: string,
  ): Promise<void> {
    try {
      const startedAt = this.now();
      const year = seoulYearOf(startedAt);
      const from = seoulYearStart(year).toISOString();
      const to = startedAt.toISOString();
      const userClient = new CollectionDiscoveryClient(
        {},
        {
          getToken: () =>
            accessToken
              ? Promise.resolve(accessToken)
              : Promise.reject(new CollectionDiscoveryClientError('AUTH')),
          clear: () => {
            accessToken = '';
          },
        },
      );
      const [user, service] = await Promise.all([
        userClient.fetchUserActivityMetrics(githubLogin, from, to),
        this.discoveryClient.fetchUserActivityMetrics(githubLogin, from, to),
      ]);
      accessToken = '';
      const observation: CollectionUserActivityObservationInput = {
        githubId,
        githubLogin,
        year,
        commitCount: Math.max(0, user.commitCount - service.commitCount),
        pullRequestCount: Math.max(
          0,
          user.pullRequestCount - service.pullRequestCount,
        ),
        issueCount: Math.max(0, user.issueCount - service.issueCount),
        repositoryCount: Math.max(
          0,
          user.repositoryCount - service.repositoryCount,
        ),
        starCount: 0,
        observedAt: this.now(),
      };
      await this.repository.upsertPrivateObservation(observation);
    } catch (error) {
      this.logger.warn({
        kind:
          error instanceof CollectionDiscoveryClientError
            ? error.kind
            : 'UNKNOWN',
      });
    } finally {
      accessToken = '';
    }
  }

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
