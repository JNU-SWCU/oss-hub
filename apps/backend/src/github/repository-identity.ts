export function repositoryNameFromNameWithOwner(nameWithOwner: string): string {
  const slashIndex = nameWithOwner.lastIndexOf('/');
  return slashIndex === -1
    ? nameWithOwner
    : nameWithOwner.slice(slashIndex + 1);
}

export function repositoryUrlFromNameWithOwner(nameWithOwner: string): string {
  return `https://github.com/${nameWithOwner}`;
}
