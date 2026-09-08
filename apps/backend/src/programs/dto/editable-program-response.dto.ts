import type {
  EditableProgramView,
  ProgramMilestoneDocumentView,
  ProgramMilestoneEditView,
  ProgramMilestoneView,
} from '../program-editor.types';
import {
  SUBMISSION_UPLOAD_ACCEPT,
  SUBMISSION_UPLOAD_FORMAT_LABEL,
  SUBMISSION_UPLOAD_MAX_BYTES,
  SUBMISSION_UPLOAD_MAX_LABEL,
} from '../../submissions/submission-upload-policy';

export class ProgramMilestoneResponseDto {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly submissionType: ProgramMilestoneView['submissionType'];
  readonly instructions: string | null;

  private constructor(milestone: ProgramMilestoneView) {
    this.id = milestone.id;
    this.name = milestone.name;
    this.startAt = milestone.startAt.toISOString();
    this.dueAt = milestone.dueAt.toISOString();
    this.submissionType = milestone.submissionType;
    this.instructions = milestone.instructions;
  }

  static from(milestone: ProgramMilestoneView): ProgramMilestoneResponseDto {
    return new ProgramMilestoneResponseDto(milestone);
  }
}

export class ProgramMilestoneDocumentResponseDto {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly templateFileName: string | null;

  private constructor(document: ProgramMilestoneDocumentView) {
    this.id = document.id;
    this.name = document.name;
    this.required = document.required;
    this.sortOrder = document.sortOrder;
    this.templateFileName = document.templateFileName;
  }

  static from(
    document: ProgramMilestoneDocumentView,
  ): ProgramMilestoneDocumentResponseDto {
    return new ProgramMilestoneDocumentResponseDto(document);
  }
}

export class ProgramMilestoneOperationResponseDto {
  readonly startAt: string;
  readonly endAt: string;

  private constructor(operation: ProgramMilestoneEditView['operation']) {
    this.startAt = operation.startAt.toISOString();
    this.endAt = operation.endAt.toISOString();
  }

  static from(
    operation: ProgramMilestoneEditView['operation'],
  ): ProgramMilestoneOperationResponseDto {
    return new ProgramMilestoneOperationResponseDto(operation);
  }
}

export class ProgramMilestoneEditResponseDto {
  readonly milestone: ProgramMilestoneResponseDto;
  readonly operation: ProgramMilestoneOperationResponseDto;
  readonly documents: readonly ProgramMilestoneDocumentResponseDto[];
  readonly fileUpload = {
    maxBytes: SUBMISSION_UPLOAD_MAX_BYTES,
    maxLabel: SUBMISSION_UPLOAD_MAX_LABEL,
    accept: SUBMISSION_UPLOAD_ACCEPT,
    formatLabel: SUBMISSION_UPLOAD_FORMAT_LABEL,
  };
  readonly fingerprint: string;

  private constructor(view: ProgramMilestoneEditView) {
    this.milestone = ProgramMilestoneResponseDto.from(view.milestone);
    this.operation = ProgramMilestoneOperationResponseDto.from(view.operation);
    this.documents = view.documents.map((document) =>
      ProgramMilestoneDocumentResponseDto.from(document),
    );
    this.fingerprint = view.fingerprint;
  }

  static from(view: ProgramMilestoneEditView): ProgramMilestoneEditResponseDto {
    return new ProgramMilestoneEditResponseDto(view);
  }
}

export class EditableProgramResponseDto {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: EditableProgramView['trackType'];
  readonly lifecycle: EditableProgramView['lifecycle'];
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  readonly deletionScopeCounts?: EditableProgramView['deletionScopeCounts'];
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly notifyOnDeadline: boolean;
  readonly description: string;
  readonly milestones: readonly ProgramMilestoneResponseDto[];
  readonly teamMinSize: number;
  readonly teamMaxSize: number;

  private constructor(program: EditableProgramView) {
    this.id = program.id;
    this.name = program.name;
    this.organizer = program.organizer;
    this.trackType = program.trackType;
    this.lifecycle = program.lifecycle;
    this.applicationTemplateKey = program.applicationTemplateKey;
    this.applicationTemplateVersion = program.applicationTemplateVersion;
    this.applicationCount = program.applicationCount;
    this.deletionScopeCounts = program.deletionScopeCounts;
    this.applicationStartAt = program.applicationStartAt.toISOString();
    this.applicationEndAt = program.applicationEndAt.toISOString();
    this.startAt = program.startAt.toISOString();
    this.endAt = program.endAt;
    this.repositoryProvisioningEnabled = program.repositoryProvisioningEnabled;
    this.notifyOnDeadline = program.notifyOnDeadline;
    this.description = program.description;
    this.milestones = program.milestones.map((milestone) =>
      ProgramMilestoneResponseDto.from(milestone),
    );
    this.teamMinSize = program.teamMinSize;
    this.teamMaxSize = program.teamMaxSize;
  }

  static from(program: EditableProgramView): EditableProgramResponseDto {
    return new EditableProgramResponseDto(program);
  }
}
