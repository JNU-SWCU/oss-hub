export interface GithubRepositoryCoordinates {
  readonly owner: string;
  readonly name: string;
}

export const GITHUB_REPOSITORY_URL_PATTERN =
  /^https:\/\/github\.com\/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/(?![^/]*\.git\/?$)[a-z0-9][a-z0-9._-]{0,99}\/?$/i;
