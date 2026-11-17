import type { ExternalProgramCover } from './program-cover-selection';

type ProgramNoticeCandidates = {
  readonly organizers?: readonly string[];
  readonly applicationPeriod?: {
    readonly startsAt?: string;
    readonly endsAt?: string;
  };
  readonly operationPeriod?: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly teamSize?: { readonly min: number; readonly max: number };
};

export type ProgramNoticeList = {
  readonly items: readonly {
    readonly url: string;
    readonly title: string;
    readonly postedAt: string;
    readonly thumbnailUrl: string | null;
  }[];
};

export type ProgramNoticePreview = {
  readonly sourceUrl: string;
  readonly name: string;
  readonly description: string;
  readonly coverImages: readonly string[];
  readonly warnings: readonly (
    'NO_IMAGE' | 'MULTIPLE_IMAGES' | 'EXTERNAL_APPLICATION_LINK'
  )[];
  readonly candidates: ProgramNoticeCandidates;
};

export type ProgramNoticePatch = {
  readonly name?: string;
  readonly description?: string;
  readonly externalCover?: ExternalProgramCover;
  readonly organizers?: readonly string[];
  readonly applicationStartAt?: string;
  readonly applicationEndAt?: string;
  readonly operationStartAt?: string;
  readonly operationEndAt?: string;
  readonly teamMinSize?: string;
  readonly teamMaxSize?: string;
};
