export interface GithubEmailEntry {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

export function selectGithubPrimaryEmail(
  emails: readonly GithubEmailEntry[],
): string | null {
  const primaryVerified = emails.find(
    (entry) => entry.primary && entry.verified,
  );
  if (primaryVerified) {
    return primaryVerified.email;
  }
  const primary = emails.find((entry) => entry.primary);
  if (primary) {
    return primary.email;
  }
  const verified = emails.find((entry) => entry.verified);
  return verified?.email ?? null;
}
