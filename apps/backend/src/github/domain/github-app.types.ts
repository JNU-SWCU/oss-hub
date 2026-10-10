export interface GithubAppCredentials {
  readonly organization: string;
  readonly appId: string;
  readonly privateKey: string;
}

export type GithubAppFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type GithubAppJwtFactory = (
  credentials: GithubAppCredentials,
  now: Date,
) => Promise<string>;

export interface GithubInstallationTokenProvider {
  readonly organization: string;
  accessToken(): Promise<string>;
  invalidateAccessToken(): void;
}
