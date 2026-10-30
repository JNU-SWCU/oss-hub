export const COSMOS_ENTRANCE_MS = 1400;
export const COSMOS_LATE_START_MS = 1200;

export function cosmosEntranceMs(startedAt: number, played: boolean): number {
  return played || startedAt > COSMOS_LATE_START_MS ? 0 : COSMOS_ENTRANCE_MS;
}
