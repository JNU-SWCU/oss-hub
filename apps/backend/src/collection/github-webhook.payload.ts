import type {
  GithubActivityEventType,
  GithubWebhookRepositoryInput,
} from './github-webhook.types';
import { GITHUB_ACTIVITY_EVENT_TYPES } from './github-webhook.types';

type JsonObject = Readonly<Record<string, unknown>>;

export class InvalidGithubWebhookPayloadError extends Error {
  override readonly name = 'InvalidGithubWebhookPayloadError';

  constructor() {
    super('invalid GitHub webhook payload');
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) {
    throw new InvalidGithubWebhookPayloadError();
  }
  return value;
}

function requiredObject(parent: JsonObject, key: string): JsonObject {
  return jsonObject(parent[key]);
}

function requiredString(parent: JsonObject, key: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidGithubWebhookPayloadError();
  }
  return value;
}

function requiredBoolean(parent: JsonObject, key: string): boolean {
  const value = parent[key];
  if (typeof value !== 'boolean') {
    throw new InvalidGithubWebhookPayloadError();
  }
  return value;
}

function requiredSafeInteger(
  parent: JsonObject,
  key: string,
  minimum: number,
): number {
  const value = parent[key];
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new InvalidGithubWebhookPayloadError();
  }
  return value;
}

function optionalDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function repositoryOccurredAt(repository: JsonObject, receivedAt: Date): Date {
  const pushedAt = repository.pushed_at;
  return typeof pushedAt === 'number' &&
    Number.isSafeInteger(pushedAt) &&
    pushedAt >= 0
    ? new Date(pushedAt * 1_000)
    : receivedAt;
}

function repositoryMetadata(repository: JsonObject) {
  return {
    githubRepositoryId: BigInt(requiredSafeInteger(repository, 'id', 1)),
    fullName: requiredString(repository, 'full_name'),
    visibility: requiredBoolean(repository, 'private')
      ? ('PRIVATE' as const)
      : ('PUBLIC' as const),
    archived: requiredBoolean(repository, 'archived'),
  };
}

function pushActivity(
  payload: JsonObject,
  repository: JsonObject,
  githubRepositoryId: bigint,
  deliveryId: string,
  receivedAt: Date,
) {
  const after = requiredString(payload, 'after');
  const commitDelta = requiredSafeInteger(payload, 'size', 0);
  const headCommit = payload.head_commit;
  const occurredAt =
    headCommit === null
      ? repositoryOccurredAt(repository, receivedAt)
      : (optionalDate(jsonObject(headCommit).timestamp) ??
        repositoryOccurredAt(repository, receivedAt));

  return {
    deliveryId,
    eventType: GITHUB_ACTIVITY_EVENT_TYPES.PUSH,
    occurredAt,
    dedupeKey: `${githubRepositoryId}:push:${after}`,
    commitDelta,
    pullRequestDelta: 0,
    starDelta: 0,
  };
}

function releaseActivity(
  payload: JsonObject,
  githubRepositoryId: bigint,
  deliveryId: string,
  receivedAt: Date,
) {
  const action = requiredString(payload, 'action');
  const release = requiredObject(payload, 'release');
  const releaseId = requiredSafeInteger(release, 'id', 1);
  const occurredAt =
    optionalDate(release.published_at) ??
    optionalDate(release.created_at) ??
    receivedAt;

  return {
    deliveryId,
    eventType: GITHUB_ACTIVITY_EVENT_TYPES.RELEASE,
    occurredAt,
    dedupeKey: `${githubRepositoryId}:release:${releaseId}:${action}`,
    commitDelta: 0,
    pullRequestDelta: 0,
    starDelta: 0,
  };
}

function parseJson(rawBody: Buffer): JsonObject {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
    return jsonObject(parsed);
  } catch (error) {
    if (error instanceof InvalidGithubWebhookPayloadError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new InvalidGithubWebhookPayloadError();
    }
    throw error;
  }
}

export function parseGithubActivity(
  rawBody: Buffer,
  eventType: GithubActivityEventType,
  targetOrg: string,
  deliveryId: string,
  receivedAt: Date,
): GithubWebhookRepositoryInput | null {
  const payload = parseJson(rawBody);
  const organization = requiredObject(payload, 'organization');
  const orgLogin = requiredString(organization, 'login');
  if (orgLogin.toLowerCase() !== targetOrg.toLowerCase()) {
    return null;
  }

  const repositoryPayload = requiredObject(payload, 'repository');
  const repository = repositoryMetadata(repositoryPayload);
  if (
    !repository.fullName.toLowerCase().startsWith(`${targetOrg.toLowerCase()}/`)
  ) {
    throw new InvalidGithubWebhookPayloadError();
  }

  switch (eventType) {
    case GITHUB_ACTIVITY_EVENT_TYPES.PUSH:
      return {
        repository,
        activity: pushActivity(
          payload,
          repositoryPayload,
          repository.githubRepositoryId,
          deliveryId,
          receivedAt,
        ),
        observedAt: receivedAt,
      };
    case GITHUB_ACTIVITY_EVENT_TYPES.RELEASE:
      return {
        repository,
        activity: releaseActivity(
          payload,
          repository.githubRepositoryId,
          deliveryId,
          receivedAt,
        ),
        observedAt: receivedAt,
      };
  }
}
