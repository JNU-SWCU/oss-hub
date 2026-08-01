import { describe, expect, it } from 'vitest';
import {
  createCosmosQualityGovernor,
  type CosmosQualityGovernor,
} from './cosmos-quality';

const BUDGET_MS = 16.7;

function record(
  governor: CosmosQualityGovernor,
  frameCount: number,
  durationMs: number,
): void {
  for (let index = 0; index < frameCount; index += 1) {
    governor.recordFrame(durationMs, BUDGET_MS);
  }
}

describe('createCosmosQualityGovernor', () => {
  it('keeps full quality while the rolling frame budget passes', () => {
    // Given
    const governor = createCosmosQualityGovernor();

    // When
    Array.from({ length: 12 }, () => 8).forEach((duration) => {
      governor.recordFrame(duration, 16.7);
    });

    // Then
    expect(governor.qualityScale()).toBe(1);
  });

  it('lowers the next-frame quality when p95 misses its budget', () => {
    // Given
    const governor = createCosmosQualityGovernor();

    // When
    Array.from({ length: 12 }, () => 24).forEach((duration) => {
      governor.recordFrame(duration, 16.7);
    });

    // Then
    expect(governor.qualityScale()).toBe(0.75);
  });

  it('never lowers quality below the safe floor', () => {
    // Given
    const governor = createCosmosQualityGovernor();

    // When
    Array.from({ length: 36 }, () => 40).forEach((duration) => {
      governor.recordFrame(duration, 16.7);
    });

    // Then
    expect(governor.qualityScale()).toBe(0.5);
  });

  it('raises quality again once frames settle well under budget', () => {
    // Given — 순간적인 멈춤 한 번으로 이미 한 단계 내려간 상태
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);

    // When
    record(governor, 36, 8);

    // Then
    expect(governor.qualityScale()).toBe(1);
  });

  it('needs a longer calm run to raise quality than a single window needed to lower it', () => {
    // Given
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);

    // When — 낮추기에 걸린 창은 하나뿐이었지만, 두 창이 좋아도 아직 올리지 않는다
    record(governor, 24, 8);

    // Then
    expect(governor.qualityScale()).toBe(0.75);

    // When
    record(governor, 12, 8);

    // Then
    expect(governor.qualityScale()).toBe(1);
  });

  it('raises quality one step at a time', () => {
    // Given — 바닥까지 내려간 상태
    const governor = createCosmosQualityGovernor();
    record(governor, 24, 40);
    expect(governor.qualityScale()).toBe(0.5);

    // When
    record(governor, 36, 8);

    // Then
    expect(governor.qualityScale()).toBe(0.75);

    // When
    record(governor, 36, 8);

    // Then
    expect(governor.qualityScale()).toBe(1);
  });

  it('restarts the calm run when a window only barely clears the budget', () => {
    // Given
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 24, 8);

    // When — 예산 안이지만 여유가 없는 창 하나가 끼어들면 연속 기록이 끊긴다
    record(governor, 12, 15);
    record(governor, 24, 8);

    // Then
    expect(governor.qualityScale()).toBe(0.75);
  });

  it('settles instead of flapping when the lowered quality only barely fits', () => {
    // Given — 최고 화질은 예산을 넘고, 한 단계 낮추면 예산 안이지만 여유는 없는 기기.
    // 여유 없는 통과만으로 되돌리는 governor라면 두 단계 사이를 영원히 오간다.
    const governor = createCosmosQualityGovernor();
    const frameCostFor = (scale: number): number => (scale === 1 ? 20 : 15);

    // When
    const observed: number[] = [];
    for (let window = 0; window < 60; window += 1) {
      record(governor, 12, frameCostFor(governor.qualityScale()));
      observed.push(governor.qualityScale());
    }

    // Then
    expect(observed[0]).toBe(0.75);
    expect(new Set(observed)).toEqual(new Set([0.75]));
  });
});
