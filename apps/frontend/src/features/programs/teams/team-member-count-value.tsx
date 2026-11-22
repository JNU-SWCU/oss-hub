import { teamMemberCountText } from './team-member-count';

export function TeamMemberCountValue({
  memberCount,
  minSize,
  maxSize,
}: {
  readonly memberCount: number;
  readonly minSize?: number;
  readonly maxSize?: number;
}) {
  const size = teamMemberCountText({ memberCount, minSize, maxSize });
  const count = <data value={memberCount}>{size.label}</data>;
  if (minSize === undefined && maxSize === undefined) return count;
  return (
    <details data-slot="team-member-count">
      <summary className="cursor-pointer" aria-label={`팀원 ${size.label}`}>
        {count}
      </summary>
      <span className="text-xs text-muted-foreground">
        {minSize !== undefined ? (
          <span>
            최소{' '}
            <data data-limit="minimum" value={minSize}>
              {minSize}명
            </data>
          </span>
        ) : null}
        {minSize !== undefined && maxSize !== undefined ? ' · ' : null}
        {maxSize !== undefined ? (
          <span>
            정원{' '}
            <data data-limit="maximum" value={maxSize}>
              {maxSize}명
            </data>
          </span>
        ) : null}
      </span>
    </details>
  );
}
