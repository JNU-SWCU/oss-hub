import { randomUUID } from 'node:crypto';

export const PROGRAM_COVER_STORAGE_PREFIX = 'program-covers/';

export function createProgramCoverObjectKey(): string {
  return `${PROGRAM_COVER_STORAGE_PREFIX}${randomUUID()}`;
}
