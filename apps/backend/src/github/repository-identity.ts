/// #617 단계 D — GithubRepository는 name/url 컬럼을 두지 않는다. 표시용 name/url은 항상
/// nameWithOwner("owner/name")에서 이 helper로 유도한다. public-projects·audit-log·DTO 매핑이
/// 전부 이 helper 하나만 쓴다 — 각자 문자열을 잘라 쓰면 파생 규칙이 흩어진다.
export function repositoryNameFromNameWithOwner(nameWithOwner: string): string {
  const slashIndex = nameWithOwner.lastIndexOf('/');
  return slashIndex === -1 ? nameWithOwner : nameWithOwner.slice(slashIndex + 1);
}

export function repositoryUrlFromNameWithOwner(nameWithOwner: string): string {
  return `https://github.com/${nameWithOwner}`;
}
