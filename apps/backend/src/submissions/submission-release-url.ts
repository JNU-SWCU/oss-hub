export function isLinkedRepositoryReleaseUrl(
  repositoryUrl: string,
  releaseUrl: string,
): boolean {
  if (!URL.canParse(repositoryUrl) || !URL.canParse(releaseUrl)) return false;

  const repository = new URL(repositoryUrl);
  const release = new URL(releaseUrl);
  if (
    repository.protocol !== 'https:' ||
    release.protocol !== repository.protocol ||
    release.host !== repository.host ||
    release.username !== '' ||
    release.password !== ''
  ) {
    return false;
  }

  const repositoryPath = repository.pathname
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  const tagPrefixes = [
    `${repositoryPath}/releases/tag/`,
    `${repositoryPath}/tree/`,
  ] as const;
  return tagPrefixes.some(
    (prefix) =>
      release.pathname.startsWith(prefix) &&
      release.pathname.length > prefix.length,
  );
}
