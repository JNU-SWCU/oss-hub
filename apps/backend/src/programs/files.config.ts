import { type Readable } from 'node:stream';
import {
  type FileLifecycle,
  type ProgramTrackType,
  type ProgramCategory,
  type ProgramLifecycle,
} from '@prisma/client';

export type ProgramAuthoringUploadToken = {
  readonly id: string;
  readonly actorId: string;
  readonly lifecycle: FileLifecycle;
  readonly unexpired: boolean;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

export type ProgramExternalCover = {
  readonly sourceUrl: string;
  readonly imageUrl: string;
};
export type ProgramAuthoringDocumentRequest = {
  readonly name: string;
  readonly required: boolean;
  readonly templateUploadId?: string | null;
};
export type ProgramAuthoringMilestoneRequest = {
  readonly name: string;
  readonly startAt?: string;
  readonly dueAt: string;
  readonly instructions?: string | null;
  readonly documents: readonly ProgramAuthoringDocumentRequest[];
};
export type ProgramAuthoringRequest = {
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover | null;
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
  readonly repositoryProvisioningEnabled?: boolean;
  readonly notifyOnDeadline?: boolean;
  readonly milestones: readonly ProgramAuthoringMilestoneRequest[];
};
export type ProgramAuthoringProgramPlan = {
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly trackType: ProgramTrackType;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly description: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
};
export type ProgramAuthoringDocumentPlan = {
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly templateUploadId: string;
};
export type ProgramAuthoringMilestonePlan = {
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly instructions: string | null;
  readonly documents: readonly ProgramAuthoringDocumentPlan[];
};
export type ProgramAuthoringPlan = {
  readonly coverUploadId?: string | null;
  readonly externalCover?: ProgramExternalCover;
  readonly program: ProgramAuthoringProgramPlan;
  readonly milestones: readonly ProgramAuthoringMilestonePlan[];
  readonly uploadTokenIds: readonly string[];
};
export type ProgramAuthoringProgram = Omit<
  ProgramAuthoringProgramPlan,
  'trackType'
> & {
  readonly trackType: ProgramTrackType | null;
  readonly id: string;
  readonly lifecycle: ProgramLifecycle;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
export type ProgramAuthoringReplay = {
  readonly payloadHash: string;
  readonly program: ProgramAuthoringProgram;
};
export type ProgramAuthoringCreateRequestInput = {
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly programId: string;
};
export type ProgramAuthoringTemplateInput = {
  readonly milestoneDocumentId: string;
  readonly actorId: string;
  readonly upload: ProgramAuthoringUploadToken;
};
export type ProgramAuthoringPendingUploadConsumption = {
  readonly milestoneDocumentId: string;
  readonly upload: ProgramAuthoringUploadToken;
};
export interface ValidatedProgramAuthoringUpload {
  readonly body: Buffer;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export const STORAGE_KEY_OWNERS = ['File'] as const;

export interface UploadedSubmissionFileResponse {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}

export interface UploadedMilestoneDocumentFileResponse {
  readonly fileId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly expiresAt: string;
}
export interface MilestoneDocumentFileUpload {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}
export interface UploadedMilestoneDocumentTemplateResponse {
  readonly documentId: string;
  readonly hasTemplateFile: true;
  readonly fileName: string;
  readonly uploadedAt: string;
}
export interface DownloadedMilestoneDocumentTemplate {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}
export interface DownloadedMilestoneDocumentSubmissionFile {
  readonly body: Readable;
  readonly fileName: string;
  readonly contentType: string;
  readonly contentLength: number;
}
