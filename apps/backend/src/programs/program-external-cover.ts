import { ProgramAuthoringValidationError } from './program-authoring.types';
import { DomainException } from '../common/error-code';
import {
  parseProgramNoticeImageUrl,
  parseProgramNoticeUrl,
} from './program-notice-url';

export type ProgramExternalCover = {
  readonly sourceUrl: string;
  readonly imageUrl: string;
};

export function validateProgramCoverChoice(input: {
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover | null;
}): ProgramExternalCover | null | undefined {
  if (input.coverUploadId !== undefined && input.externalCover !== undefined) {
    throw new ProgramAuthoringValidationError([
      { path: 'externalCover', code: 'CONFLICTING_COVER_CHOICES' },
    ]);
  }
  if (input.externalCover == null) return input.externalCover;
  try {
    const source = parseProgramNoticeUrl(input.externalCover.sourceUrl);
    const image = parseProgramNoticeImageUrl(
      input.externalCover.imageUrl,
      source,
    );
    if (image !== null) return { sourceUrl: source.href, imageUrl: image.href };
  } catch (error) {
    if (!(error instanceof DomainException)) throw error;
  }
  throw new ProgramAuthoringValidationError([
    { path: 'externalCover', code: 'INVALID_EXTERNAL_COVER' },
  ]);
}
