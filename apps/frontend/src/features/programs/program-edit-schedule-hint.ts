import { formatSeoulDate } from './program-detail-format';

export function earliestInstant(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((earliest, current) =>
    current < earliest ? current : earliest,
  );
}

export function latestInstant(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((latest, current) =>
    current > latest ? current : latest,
  );
}

export function programStartBoundHint(
  milestoneStartAts: readonly string[],
): string | null {
  const earliest = earliestInstant(milestoneStartAts);
  if (earliest === null) return null;
  return `가장 이른 마일스톤 시작은 ${formatSeoulDate(earliest)}입니다. 운영 시작은 이 시각과 같거나 빨라야 합니다.`;
}

export function programEndBoundHint(
  milestoneDueAts: readonly string[],
): string | null {
  const latest = latestInstant(milestoneDueAts);
  if (latest === null) return null;
  return `가장 늦은 마일스톤 마감은 ${formatSeoulDate(latest)}입니다. 종료일은 이 시각 이후여야 합니다.`;
}
