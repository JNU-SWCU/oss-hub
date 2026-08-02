export interface CosmosQualityGovernor {
  readonly qualityScale: () => number;
  readonly recordFrame: (durationMs: number, budgetMs: number) => void;
}

const SAMPLE_WINDOW = 12;
const QUALITY_STEPS = [1, 0.75, 0.5] as const;

/**
 * 복귀 판정선. 예산 바로 아래(예: 95%)에서 올리면, 해상도를 되돌리는 순간 예산을
 * 다시 넘겨 곧장 내려가고 — 두 단계 사이를 계속 오간다. 되돌릴 여력이 실제로 있는지
 * 확인하려면 "겨우 통과"가 아니라 "여유 있게 통과"를 요구해야 한다.
 */
const RECOVERY_BUDGET_RATIO = 0.7;

/**
 * 낮추기는 한 창(12프레임)이면 충분하다 — 끊기는 화면은 즉시 손봐야 한다. 반대로
 * 올리기는 연속 세 창을 요구한다. 신호의 세기를 비대칭으로 둬야, 잠깐 좋아졌다가
 * 다시 나빠지는 구간에서 화질이 출렁이지 않는다.
 */
const RECOVERY_WINDOWS = 3;

export function createCosmosQualityGovernor(): CosmosQualityGovernor {
  let qualityIndex = 0;
  let samples: number[] = [];
  // 예산에 여유 있게 들어온 창이 몇 개 연속인지. 그 사이 한 번이라도 어긋나면 0으로 돌아간다.
  let calmWindows = 0;
  // 직전 창에서 막 올라왔는지. 올린 단계의 첫 창만이 그 단계에 대한 판정이다.
  let justRaised = false;
  /**
   * 이 기기가 올라갈 수 있는 최고 단계. 여유선과 연속 조건은 프레임 비용이 화질과
   * 무관할 때만 출렁임을 막는다. 낮은 단계가 싸고 높은 단계가 예산을 넘는 기기에서는
   * 여유가 진짜여도 올라간 뒤에는 남아 있지 않아, 올렸다 내렸다를 영원히 반복한다.
   * 그래서 올린 직후 첫 창이 예산을 넘기면 그 단계를 한계로 적어 두고 다시 넘보지 않는다.
   * 한 번 올라가 재 본 결과라, 우연한 멈춤 하나로 묶이는 것과는 다르다.
   */
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
        // 예산 초과는 곧바로 반영한다. 동시에 복귀 연속 기록도 끊는다 —
        // 초과와 여유를 번갈아 겪는 기기는 "여유롭다"고 볼 수 없다.
        calmWindows = 0;
        // 막 올라온 단계가 첫 창부터 예산을 넘겼다면, 그 단계는 이 기기에 맞지 않는다.
        if (justRaised) ceilingIndex = qualityIndex + 1;
        justRaised = false;
        if (qualityIndex < QUALITY_STEPS.length - 1) qualityIndex += 1;
        return;
      }

      // 예산 안으로 들어온 창 하나면 방금 올린 단계는 시험을 통과한 것이다.
      justRaised = false;

      if (p95 > budgetMs * RECOVERY_BUDGET_RATIO) {
        // 예산 안이지만 여유는 없는 구간. 유지만 하고 복귀 기록은 다시 센다.
        calmWindows = 0;
        return;
      }

      calmWindows += 1;
      if (calmWindows < RECOVERY_WINDOWS) return;
      calmWindows = 0;
      // 한 번에 최고 화질로 뛰지 않고 한 단계씩 올린다. 잘못 판단했더라도
      // 되돌릴 거리가 짧아 사용자가 알아채기 전에 수습된다.
      if (qualityIndex > ceilingIndex) {
        qualityIndex -= 1;
        justRaised = true;
      }
    },
  };
}
