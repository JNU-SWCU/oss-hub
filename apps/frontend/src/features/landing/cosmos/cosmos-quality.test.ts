import { describe, expect, it } from 'vitest';
import { createCosmosQualityGovernor } from './cosmos-quality';

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
});
