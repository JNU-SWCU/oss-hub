import type { AuditLogTransactionWriter } from '../../prisma/audit-log-transaction-writer';
import type { ProgramExternalCover } from '../domain/program-external-cover';
import type {
  ProgramAuthoringProgramPlan,
  ProgramAuthoringUploadToken,
  ProgramAuthoringProgram,
  ProgramAuthoringCreateRequestInput,
  ProgramAuthoringMilestonePlan,
  ProgramAuthoringDocumentPlan,
  ProgramAuthoringTemplateInput,
} from '../domain/program-authoring.types';

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
