export interface CosmosQualityGovernor {
  readonly qualityScale: () => number;
  readonly recordFrame: (durationMs: number, budgetMs: number) => void;
}

const SAMPLE_WINDOW = 12;
const QUALITY_STEPS = [1, 0.75, 0.5] as const;

export function createCosmosQualityGovernor(): CosmosQualityGovernor {
  let qualityIndex = 0;
  let samples: number[] = [];
  return {
    qualityScale: () => QUALITY_STEPS[qualityIndex] ?? 0.5,
    recordFrame(durationMs, budgetMs): void {
      samples.push(Math.max(0, durationMs));
      if (samples.length < SAMPLE_WINDOW) return;
      const sorted = [...samples].sort((first, second) => first - second);
      const percentileIndex = Math.ceil(sorted.length * 0.95) - 1;
      const p95 = sorted[percentileIndex] ?? 0;
      if (p95 > budgetMs && qualityIndex < QUALITY_STEPS.length - 1) {
        qualityIndex += 1;
      }
      samples = [];
    },
  };
}
