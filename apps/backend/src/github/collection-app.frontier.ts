/**
 * Exact-request fingerprint and endpoint-specific frontier value objects for
 * incremental Collection App reads (ADR-006 조직 전체 누적·증분 수집 계약).
 *
 * These are pure, storage-agnostic contracts: `CollectionAppClient` returns
 * them and callers (todo 10 sync orchestration) are responsible for
 * persisting/comparing them against the previous run's checkpoint. Nothing
 * here reads or writes Prisma.
 */

/**
 * Identifies one exact HTTP request shape: endpoint, ref/branch, query,
 * explicit ordering, page size, `Accept`, and API version. A nullable ETag
 * is only ever valid against the fingerprint that produced it — different
 * fingerprints (e.g. a `per_page=1` probe vs a `per_page=100` full listing
 * on the same endpoint) must never share one ETag.
 */
export interface RequestFingerprint {
  readonly endpoint: string;
  readonly ref: string | null;
  readonly query: string;
  readonly order: string | null;
  readonly pageSize: number;
  readonly accept: string;
  readonly apiVersion: string;
}

/** Stable canonical string key for storing an ETag against a fingerprint. */
export function requestFingerprintKey(fingerprint: RequestFingerprint): string {
  return [
    fingerprint.endpoint,
    fingerprint.ref ?? '',
    fingerprint.query,
    fingerprint.order ?? '',
    String(fingerprint.pageSize),
    fingerprint.accept,
    fingerprint.apiVersion,
  ].join('\u001f');
}

/** Commit stream frontier: the default-branch head SHA last observed. */
export interface CommitFrontier {
  readonly headSha: string;
}

/** Pull request stream frontier: `(createdAt, githubPullRequestId)` tie-break. */
export interface PullRequestFrontier {
  readonly createdAt: string;
  readonly id: string;
}

/** Issue stream frontier: the same `(createdAt, id)` tie-break over the issue listing. */
export type IssueFrontier = PullRequestFrontier;

/** Release stream frontier: opaque representation of the latest probe item. */
export interface ReleaseFrontier {
  readonly probe: string;
}
