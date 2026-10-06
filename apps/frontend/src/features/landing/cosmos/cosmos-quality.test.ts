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
    const governor = createCosmosQualityGovernor();

    Array.from({ length: 12 }, () => 8).forEach((duration) => {
      governor.recordFrame(duration, 16.7);
    });

    expect(governor.qualityScale()).toBe(1);
  });

  it('lowers the next-frame quality when p95 misses its budget', () => {
    const governor = createCosmosQualityGovernor();

    Array.from({ length: 12 }, () => 24).forEach((duration) => {
      governor.recordFrame(duration, 16.7);
    });

    expect(governor.qualityScale()).toBe(0.75);
  });

  it('never lowers quality below the safe floor', () => {
    const governor = createCosmosQualityGovernor();

    Array.from({ length: 36 }, () => 40).forEach((duration) => {
      governor.recordFrame(duration, 16.7);
    });

    expect(governor.qualityScale()).toBe(0.5);
  });

  it('raises quality again once frames settle well under budget', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);

    record(governor, 36, 8);

    expect(governor.qualityScale()).toBe(1);
  });

  it('needs a longer calm run to raise quality than a single window needed to lower it', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);

    record(governor, 24, 8);

    expect(governor.qualityScale()).toBe(0.75);

    record(governor, 12, 8);

    expect(governor.qualityScale()).toBe(1);
  });

  it('raises quality one step at a time', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 24, 40);
    expect(governor.qualityScale()).toBe(0.5);

    record(governor, 36, 8);

    expect(governor.qualityScale()).toBe(0.75);

    record(governor, 36, 8);

    expect(governor.qualityScale()).toBe(1);
  });

  it('restarts the calm run when a window only barely clears the budget', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 24, 8);

    record(governor, 12, 15);
    record(governor, 24, 8);

    expect(governor.qualityScale()).toBe(0.75);
  });

  it('counts a window sitting exactly on the recovery line as calm', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);

    record(governor, 36, BUDGET_MS * 0.7);

    expect(governor.qualityScale()).toBe(1);
  });

  it('restarts the calm run when a window blows the budget outright', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 24, 8);

    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.5);
    record(governor, 24, 8);

    expect(governor.qualityScale()).toBe(0.5);
  });

  it('stays at full quality no matter how long the calm run continues', () => {
    const governor = createCosmosQualityGovernor();

    record(governor, 72, 8);

    expect(governor.qualityScale()).toBe(1);
  });

  it('settles instead of flapping when the lowered quality only barely fits', () => {
    const governor = createCosmosQualityGovernor();
    const frameCostFor = (scale: number): number => (scale === 1 ? 20 : 15);

    const observed: number[] = [];
    for (let window = 0; window < 60; window += 1) {
      record(governor, 12, frameCostFor(governor.qualityScale()));
      observed.push(governor.qualityScale());
    }

    expect(observed[0]).toBe(0.75);
    expect(new Set(observed)).toEqual(new Set([0.75]));
  });

  it('settles when the top step is the very thing that blows the budget', () => {
    const governor = createCosmosQualityGovernor();
    const frameCostFor = (scale: number): number => (scale === 1 ? 20 : 8);

    const observed: number[] = [];
    for (let window = 0; window < 60; window += 1) {
      record(governor, 12, frameCostFor(governor.qualityScale()));
      observed.push(governor.qualityScale());
    }

    expect(new Set(observed.slice(-20))).toEqual(new Set([0.75]));
  });

  it('retries a step when a single stray frame spoiled the promotion window', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(1);

    record(governor, 11, 8);
    governor.recordFrame(40, BUDGET_MS);
    expect(governor.qualityScale()).toBe(0.75);

    record(governor, 36, 8);

    expect(governor.qualityScale()).toBe(1);
  });

  it('does not carry a failure over to a different step', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 36, 8);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.5);

    record(governor, 36, 8);
    record(governor, 12, 24);
    record(governor, 36, 8);

    expect(governor.qualityScale()).toBe(0.75);
  });

  it('does not carry a failure across a promotion that proved itself', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 24, 40);
    expect(governor.qualityScale()).toBe(0.5);
    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.5);

    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 12, 8);
    record(governor, 24, 8);
    expect(governor.qualityScale()).toBe(1);

    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 36, 8);

    expect(governor.qualityScale()).toBe(1);
  });

  it('does not count a late stall as the verdict on an earlier promotion', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(1);
    record(governor, 12, 8);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);

    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(1);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 36, 8);

    expect(governor.qualityScale()).toBe(1);
  });

  it('does not cap the ceiling when stalls arrive long after the step proved itself', () => {
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      record(governor, 36, 8);
      expect(governor.qualityScale()).toBe(1);

      record(governor, 12, 8);

      record(governor, 12, 24);
      expect(governor.qualityScale()).toBe(0.75);
    }
    record(governor, 36, 8);

    expect(governor.qualityScale()).toBe(1);
  });
});
