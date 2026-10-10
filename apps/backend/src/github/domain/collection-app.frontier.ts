export interface RequestFingerprint {
  readonly endpoint: string;
  readonly ref: string | null;
  readonly query: string;
  readonly order: string | null;
  readonly pageSize: number;
  readonly accept: string;
  readonly apiVersion: string;
}

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

export interface CommitFrontier {
  readonly headSha: string;
}

export interface PullRequestFrontier {
  readonly createdAt: string;
  readonly id: string;
}

export type IssueFrontier = PullRequestFrontier;

export interface ReleaseFrontier {
  readonly probe: string;
}
