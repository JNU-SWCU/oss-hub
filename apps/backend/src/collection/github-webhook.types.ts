export const GITHUB_ACTIVITY_EVENT_TYPES = {
  PUSH: 'push',
  RELEASE: 'release',
} as const;

export type GithubActivityEventType =
  (typeof GITHUB_ACTIVITY_EVENT_TYPES)[keyof typeof GITHUB_ACTIVITY_EVENT_TYPES];

export interface GithubWebhookRepositoryInput {
  readonly repository: {
    readonly githubRepositoryId: bigint;
    readonly fullName: string;
    readonly visibility: 'PRIVATE' | 'PUBLIC';
    readonly archived: boolean;
  };
  readonly activity: {
    readonly deliveryId: string;
    readonly eventType: GithubActivityEventType;
    readonly occurredAt: Date;
    readonly dedupeKey: string;
    readonly commitDelta: number;
    readonly pullRequestDelta: number;
    readonly starDelta: number;
  };
  readonly observedAt: Date;
}

export type GithubWebhookOutcome =
  | { readonly outcome: 'accepted' }
  | { readonly outcome: 'duplicate' }
  | { readonly outcome: 'ignored' };

export interface GithubWebhookRequest {
  readonly rawBody: Buffer;
  readonly signature: string | undefined;
  readonly deliveryId: string | undefined;
  readonly eventType: string | undefined;
  readonly receivedAt: Date;
}
