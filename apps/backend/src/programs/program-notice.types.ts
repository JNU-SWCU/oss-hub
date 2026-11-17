export type ProgramNoticeCandidates = {
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

import type { ProgramNoticeWarning } from './program-notice.config';

export type { ProgramNoticeWarning } from './program-notice.config';

export type ProgramNoticePreview = {
  readonly sourceUrl: string;
  readonly name: string;
  readonly description: string;
  readonly coverImages: string[];
  readonly warnings: ProgramNoticeWarning[];
  readonly candidates: ProgramNoticeCandidates;
};

export type ProgramNoticeList = {
  readonly items: readonly {
    readonly url: string;
    readonly title: string;
    readonly postedAt: string;
    readonly thumbnailUrl: string | null;
  }[];
};
