export const PROGRAM_COVER_STORAGE_PREFIX = 'program-covers/';

export function programCoverImageUrl(
  programId: string,
  coverId: string | null | undefined,
  externalImageUrl?: string | null,
): string | null {
  if (externalImageUrl != null) return externalImageUrl;
  return coverId
    ? `/programs/${encodeURIComponent(programId)}/cover/${encodeURIComponent(coverId)}`
    : null;
}
