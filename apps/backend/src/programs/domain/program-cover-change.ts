import type { ProgramExternalCover } from './program-external-cover';

export type ProgramCoverChange = {
  readonly actorId: string;
} & (
  | { readonly uploadId: string | null; readonly externalCover?: never }
  | {
      readonly externalCover: ProgramExternalCover | null;
      readonly uploadId?: never;
    }
);
