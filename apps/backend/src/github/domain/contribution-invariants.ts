export interface ContributionInvariantResult {
  readonly name: string;
  readonly ok: boolean;

  readonly violationCount: number;

  readonly detail: string;
}

export interface ContributionInvariantReport {
  readonly checkedAt: Date;
  readonly ok: boolean;
  readonly results: readonly ContributionInvariantResult[];
}
