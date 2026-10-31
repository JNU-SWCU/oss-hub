export interface GithubRepositoryCoordinates {
  readonly owner: string;
  readonly name: string;
}

const GITHUB_OWNER = '[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?';
const GITHUB_REPOSITORY_NAME = '(?![^/]*\\.git/?$)[a-z0-9][a-z0-9._-]{0,99}';

export const GITHUB_REPOSITORY_URL_PATTERN = new RegExp(
  `^https://github\\.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY_NAME}/?$`,
  'i',
);
