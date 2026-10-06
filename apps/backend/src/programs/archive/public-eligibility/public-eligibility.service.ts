import { Injectable } from '@nestjs/common';
import { ProgramMetricsRepository } from '../../repository/program-metrics.repository';
import { isPublicEligible } from './domain/public-eligibility';

export interface PublicEligibilityCandidate {
  readonly githubRepositoryId: bigint;
  readonly publishedAt: Date;
}

@Injectable()
export class PublicEligibilityService {
  constructor(private readonly metrics: ProgramMetricsRepository) {}

  async filterEligibleRepositoryIds(
    candidates: readonly PublicEligibilityCandidate[],
  ): Promise<ReadonlySet<bigint>> {
    if (candidates.length === 0) return new Set();

    const metrics = await this.metrics.getRepositoryMetrics({
      repositoryIds: candidates.map(
        (candidate) => candidate.githubRepositoryId,
      ),
    });
    const observationByRepositoryId = new Map(
      metrics.map((metric) => [metric.repositoryId, metric]),
    );

    const eligible = new Set<bigint>();
    for (const candidate of candidates) {
      const metric = observationByRepositoryId.get(
        candidate.githubRepositoryId,
      );
      const decision = isPublicEligible({
        platformPublic: true,
        publishedAt: candidate.publishedAt,
        observation:
          metric === undefined
            ? null
            : {
                visibility: metric.visibility,
                presence: metric.presence,
                observedAt: metric.visibilityObservedAt,
              },
      });
      if (decision) eligible.add(candidate.githubRepositoryId);
    }
    return eligible;
  }

  async isEligible(candidate: PublicEligibilityCandidate): Promise<boolean> {
    const eligible = await this.filterEligibleRepositoryIds([candidate]);
    return eligible.has(candidate.githubRepositoryId);
  }
}
