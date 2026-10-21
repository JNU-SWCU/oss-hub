import type { ProgramTrackType } from '@prisma/client';
import type { ProgramExternalCover } from './program-external-cover';

export type CreateProgramCommand = {
  readonly name: string;
  readonly organizer: string;
  readonly trackType: ProgramTrackType;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly startAt?: string;
  readonly endAt: string;
  readonly teamMinSize?: number | null;
  readonly teamMaxSize?: number | null;
  readonly description: string;
};

export type UpdateProgramCommand = Omit<CreateProgramCommand, 'endAt'> & {
  readonly endAt?: string | null;
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover | null;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};

export type UpsertMilestoneCommand = {
  readonly name: string;
  readonly startAt?: string;
  readonly dueAt: string;
  readonly instructions?: string | null;
};

type EditMilestoneDocumentCommand = {
  readonly id: string | null;
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string;
};

export type EditMilestoneCommand = {
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly instructions: string | null;
  readonly documents: readonly EditMilestoneDocumentCommand[];
  readonly expectedFingerprint: string;
};

export type MilestoneUpdateCommand =
  | { readonly kind: 'aggregate'; readonly input: EditMilestoneCommand }
  | { readonly kind: 'legacy'; readonly input: UpsertMilestoneCommand };
