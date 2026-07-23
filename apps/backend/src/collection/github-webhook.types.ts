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

export const GITHUB_WEBHOOK_OBSERVATION_OUTCOMES = {
  ACCEPTED: 'ACCEPTED',
  DUPLICATE: 'DUPLICATE',
  IGNORED: 'IGNORED',
  FAILED: 'FAILED',
} as const;

export const GITHUB_WEBHOOK_OBSERVATION_ERROR_CODES = {
  INVALID_PAYLOAD: 'COL_WEBHOOK_INVALID_PAYLOAD',
  PROCESSING_FAILED: 'COL_WEBHOOK_PROCESSING_FAILED',
} as const;

type GithubWebhookObservationBase = {
  readonly deliveryId: string;
  readonly eventType: string;
  readonly receivedAt: Date;
};

export type GithubWebhookObservationInput = GithubWebhookObservationBase &
  (
    | {
        readonly outcome: 'ACCEPTED' | 'DUPLICATE' | 'IGNORED';
      }
    | {
        readonly outcome: 'FAILED';
        readonly errorCode: (typeof GITHUB_WEBHOOK_OBSERVATION_ERROR_CODES)[keyof typeof GITHUB_WEBHOOK_OBSERVATION_ERROR_CODES];
      }
  );

export type GithubWebhookObservationSummary = {
  readonly lastReceivedAt: Date | null;
  readonly counts: {
    readonly accepted: number;
    readonly duplicate: number;
    readonly ignored: number;
    readonly failed: number;
  };
};

export interface GithubWebhookRequest {
  readonly rawBody: Buffer;
  readonly signature: string | undefined;
  readonly deliveryId: string | undefined;
  readonly eventType: string | undefined;
  readonly receivedAt: Date;
}
