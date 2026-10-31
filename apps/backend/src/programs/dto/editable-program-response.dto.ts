import type {
  EditableProgramView,
  ProgramMilestoneDocumentView,
  ProgramMilestoneEditView,
  ProgramMilestoneView,
} from '../program-editor.repository';
import {
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
  SUBMISSION_TEMPLATE_ACCEPT,
  SUBMISSION_TEMPLATE_FORMAT_LABEL,
} from '../submission-upload.config';

export class ProgramMilestoneResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly startAt: string;
  declare readonly dueAt: string;
  declare readonly submissionType: ProgramMilestoneView['submissionType'];
  declare readonly instructions: string | null;

  static from(milestone: ProgramMilestoneView): ProgramMilestoneResponseDto {
    return {
      id: milestone.id,
      name: milestone.name,
      startAt: milestone.startAt.toISOString(),
      dueAt: milestone.dueAt.toISOString(),
      submissionType: milestone.submissionType,
      instructions: milestone.instructions,
    };
  }
}

export class ProgramMilestoneDocumentResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly required: boolean;
  declare readonly sortOrder: number;
  declare readonly templateFileName: string | null;

  static from(
    document: ProgramMilestoneDocumentView,
  ): ProgramMilestoneDocumentResponseDto {
    return {
      id: document.id,
      name: document.name,
      required: document.required,
      sortOrder: document.sortOrder,
      templateFileName: document.templateFileName,
    };
  }
}

export class ProgramMilestoneOperationResponseDto {
  declare readonly startAt: string;
  declare readonly endAt: string;

  static from(
    operation: ProgramMilestoneEditView['operation'],
  ): ProgramMilestoneOperationResponseDto {
    return {
      startAt: operation.startAt.toISOString(),
      endAt: operation.endAt.toISOString(),
    };
  }
}

export class ProgramMilestoneEditResponseDto {
  declare readonly milestone: ProgramMilestoneResponseDto;
  declare readonly operation: ProgramMilestoneOperationResponseDto;
  declare readonly documents: readonly ProgramMilestoneDocumentResponseDto[];
  declare readonly fileUpload: {
    readonly maxBytes: number;
    readonly maxLabel: string;
    readonly accept: string;
    readonly formatLabel: string;
  };
  declare readonly fingerprint: string;

  static from(view: ProgramMilestoneEditView): ProgramMilestoneEditResponseDto {
    return {
      milestone: ProgramMilestoneResponseDto.from(view.milestone),
      operation: ProgramMilestoneOperationResponseDto.from(view.operation),
      documents: view.documents.map((document) =>
        ProgramMilestoneDocumentResponseDto.from(document),
      ),
      fileUpload: {
        maxBytes: SUBMISSION_UPLOAD_MAX_BYTES,
        maxLabel: SUBMISSION_UPLOAD_MAX_LABEL,
        accept: SUBMISSION_TEMPLATE_ACCEPT,
        formatLabel: SUBMISSION_TEMPLATE_FORMAT_LABEL,
      },
      fingerprint: view.fingerprint,
    };
  }
}

export class EditableProgramResponseDto {
  declare readonly externalCover: NonNullable<
    EditableProgramView['externalCover']
  > | null;
  declare readonly coverImageUrl: string | null;
  declare readonly id: string;
  declare readonly name: string;
  declare readonly organizer: string;
  declare readonly trackType: EditableProgramView['trackType'];
  declare readonly lifecycle: EditableProgramView['lifecycle'];
  declare readonly applicationTemplateKey: string;
  declare readonly applicationTemplateVersion: number;
  declare readonly applicationCount: number;
  declare readonly deletionScopeCounts?: EditableProgramView['deletionScopeCounts'];
  declare readonly applicationStartAt: string;
  declare readonly applicationEndAt: string;
  declare readonly startAt: string;
  declare readonly endAt: string;
  declare readonly repositoryProvisioningEnabled: boolean;
  declare readonly notifyOnDeadline: boolean;
  declare readonly description: string;
  declare readonly milestones: readonly ProgramMilestoneResponseDto[];
  declare readonly teamMinSize: number;
  declare readonly teamMaxSize: number;

  static from(program: EditableProgramView): EditableProgramResponseDto {
    return {
      externalCover: program.externalCover ?? null,
      coverImageUrl: program.coverImageUrl ?? null,
      id: program.id,
      name: program.name,
      organizer: program.organizer,
      trackType: program.trackType,
      lifecycle: program.lifecycle,
      applicationTemplateKey: program.applicationTemplateKey,
      applicationTemplateVersion: program.applicationTemplateVersion,
      applicationCount: program.applicationCount,
      deletionScopeCounts: program.deletionScopeCounts,
      applicationStartAt: program.applicationStartAt.toISOString(),
      applicationEndAt: program.applicationEndAt.toISOString(),
      startAt: program.startAt.toISOString(),
      endAt: program.endAt,
      repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
      notifyOnDeadline: program.notifyOnDeadline,
      description: program.description,
      milestones: program.milestones.map((milestone) =>
        ProgramMilestoneResponseDto.from(milestone),
      ),
      teamMinSize: program.teamMinSize,
      teamMaxSize: program.teamMaxSize,
    };
  }
}
