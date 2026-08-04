/** Seed IDs may contain `:` — always encode in hrefs (`program-paths.ts`와 동일 규칙). */
export function boardListHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/board`;
}

export function boardPostHref(programId: string, postId: string): string {
  return `${boardListHref(programId)}/${encodeURIComponent(postId)}`;
}
