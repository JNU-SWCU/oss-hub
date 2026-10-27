import { describe, expect, it } from 'vitest';
import {
  COSMOS_ENTRANCE_MS,
  COSMOS_LATE_START_MS,
  cosmosEntranceMs,
} from './cosmos-entrance';

describe('cosmosEntranceMs', () => {
  it('plays the full entrance when the canvas starts within the late-start window', () => {
    expect(cosmosEntranceMs(0, false)).toBe(COSMOS_ENTRANCE_MS);
    expect(cosmosEntranceMs(COSMOS_LATE_START_MS, false)).toBe(
      COSMOS_ENTRANCE_MS,
    );
  });

  it('skips the entrance when the canvas starts after the late-start window', () => {
    expect(cosmosEntranceMs(COSMOS_LATE_START_MS + 1, false)).toBe(0);
    expect(cosmosEntranceMs(8300, false)).toBe(0);
  });

  it('skips the entrance once it already played in this session', () => {
    expect(cosmosEntranceMs(100, true)).toBe(0);
  });
});
