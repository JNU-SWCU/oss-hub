export interface CosmosQualityGovernor {
  readonly qualityScale: () => number;
  readonly recordFrame: (durationMs: number, budgetMs: number) => void;
}

const SAMPLE_WINDOW = 12;
const QUALITY_STEPS = [1, 0.75, 0.5] as const;

const RECOVERY_BUDGET_RATIO = 0.7;

const RECOVERY_WINDOWS = 3;

const RAISE_FAILURE_LIMIT = 2;

export function createCosmosQualityGovernor(): CosmosQualityGovernor {
  let qualityIndex = 0;
  let samples: number[] = [];

  let calmWindows = 0;

  let justRaised = false;

  let raiseFailures = 0;

  let ceilingIndex = 0;

  return {
    qualityScale: () => QUALITY_STEPS[qualityIndex] ?? 0.5,
    recordFrame(durationMs, budgetMs): void {
      samples.push(Math.max(0, durationMs));
      if (samples.length < SAMPLE_WINDOW) return;
      const sorted = [...samples].sort((first, second) => first - second);
      const percentileIndex = Math.ceil(sorted.length * 0.95) - 1;
      const p95 = sorted[percentileIndex] ?? 0;
      samples = [];

      if (p95 > budgetMs) {
        calmWindows = 0;
        if (justRaised) {
          raiseFailures += 1;
          if (raiseFailures >= RAISE_FAILURE_LIMIT)
            ceilingIndex = qualityIndex + 1;
        } else {
          raiseFailures = 0;
        }
        justRaised = false;
        if (qualityIndex < QUALITY_STEPS.length - 1) qualityIndex += 1;
        return;
      }

      if (justRaised) {
        justRaised = false;
        raiseFailures = 0;
      }

      if (p95 > budgetMs * RECOVERY_BUDGET_RATIO) {
        calmWindows = 0;
        return;
      }

      calmWindows += 1;
      if (calmWindows < RECOVERY_WINDOWS) return;
      calmWindows = 0;

      if (qualityIndex > ceilingIndex) {
        qualityIndex -= 1;
        justRaised = true;
      }
    },
  };
}
