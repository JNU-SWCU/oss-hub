export function boardListHref(programId: string): string {
  return `/programs/${encodeURIComponent(programId)}/board`;
}

export function boardPostHref(programId: string, postId: string): string {
  return `${boardListHref(programId)}/${encodeURIComponent(postId)}`;
}
