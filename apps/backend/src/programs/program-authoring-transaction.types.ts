import type { AuditLogTransactionWriter } from '../platform/prisma.service';
import type {
  ProgramExternalCover,
  ProgramAuthoringProgramPlan,
  ProgramAuthoringUploadToken,
  ProgramAuthoringProgram,
  ProgramAuthoringCreateRequestInput,
  ProgramAuthoringMilestonePlan,
  ProgramAuthoringDocumentPlan,
  ProgramAuthoringTemplateInput,
} from './program-authoring.policy';

export interface ProgramAuthoringTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  createProgram(
    plan: ProgramAuthoringProgramPlan,
    cover?:
      | {
          readonly actorId: string;
          readonly upload: ProgramAuthoringUploadToken;
        }
      | { readonly externalCover: ProgramExternalCover },
  ): Promise<ProgramAuthoringProgram>;
  createRequest(input: ProgramAuthoringCreateRequestInput): Promise<string>;
  lockUploads(
    tokenIds: readonly string[],
  ): Promise<readonly ProgramAuthoringUploadToken[]>;
  createMilestone(
    programId: string,
    plan: ProgramAuthoringMilestonePlan,
  ): Promise<string>;
  createDocument(
    milestoneId: string,
    plan: ProgramAuthoringDocumentPlan,
  ): Promise<string>;
  createTemplate(input: ProgramAuthoringTemplateInput): Promise<void>;
  attachUploads(
    actorId: string,
    requestId: string,
    tokenIds: readonly string[],
  ): Promise<void>;
}
