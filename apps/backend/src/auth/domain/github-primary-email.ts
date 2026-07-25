/** GitHub GET /user/emails 응답 항목(검증 후 도메인 입력). */
export interface GithubEmailEntry {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

/**
 * 알림 시드용 primary 이메일 선택.
 * 우선순위: primary+verified > primary > first verified. 없으면 null.
 */
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
