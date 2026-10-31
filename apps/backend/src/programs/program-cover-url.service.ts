import { Injectable } from '@nestjs/common';

@Injectable()
export class ProgramCoverUrlService {
  programCoverImageUrl(
    programId: string,
    coverId: string | null | undefined,
    externalImageUrl?: string | null,
  ): string | null {
    if (externalImageUrl != null) return externalImageUrl;
    return coverId
      ? `/programs/${encodeURIComponent(programId)}/cover/${encodeURIComponent(coverId)}`
      : null;
  }
}
