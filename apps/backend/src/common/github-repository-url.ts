export interface GithubRepositoryCoordinates {
  readonly owner: string;
  readonly name: string;
}

export function parseGithubRepositoryUrl(
  repositoryUrl: string,
): GithubRepositoryCoordinates | null {
  if (!URL.canParse(repositoryUrl)) {
    return null;
  }
  const parsed = new URL(repositoryUrl);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return null;
  }
  const segments = parsed.pathname.split('/').filter((part) => part !== '');
  if (segments.length !== 2) {
    return null;
  }
  const [owner, name] = segments;
  if (
    owner === undefined ||
    name === undefined ||
    !isGithubOwnerSegment(owner) ||
    !isGithubRepositoryNameSegment(name)
  ) {
    return null;
  }
  return { owner, name };
}

function isGithubOwnerSegment(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
}

function isGithubRepositoryNameSegment(value: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) &&
    !value.toLowerCase().endsWith('.git')
  );
}
