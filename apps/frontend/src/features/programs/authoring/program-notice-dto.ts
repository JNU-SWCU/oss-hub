import type { ExternalProgramCover } from './program-cover-selection';

export type ProgramNoticePreview = {
  readonly sourceUrl: string;
  readonly name: string;
  readonly description: string;
  readonly coverImages: readonly string[];
  readonly warnings: readonly (
    'NO_IMAGE' | 'MULTIPLE_IMAGES' | 'EXTERNAL_APPLICATION_LINK'
  )[];
};

export type ProgramNoticePatch = {
  readonly name?: string;
  readonly description?: string;
  readonly externalCover?: ExternalProgramCover;
};
