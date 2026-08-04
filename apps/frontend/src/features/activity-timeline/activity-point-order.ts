import type { ActivityPoint } from './types';

export interface OrderedActivityPoints {
  readonly chart: readonly ActivityPoint[];
  readonly table: readonly ActivityPoint[];
}

export function orderActivityPoints(
  points: readonly ActivityPoint[],
): OrderedActivityPoints {
  const chart = [...points].sort((left, right) =>
    left.period.localeCompare(right.period),
  );

  return { chart, table: [...chart].reverse() };
}
