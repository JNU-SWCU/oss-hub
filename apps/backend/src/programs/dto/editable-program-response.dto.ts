import type {
  EditableProgramView,
  ProgramMilestoneView,
} from '../program-editor.types';

export class ProgramMilestoneResponseDto {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly submissionType: ProgramMilestoneView['submissionType'];
  readonly instructions: string | null;

  private constructor(milestone: ProgramMilestoneView) {
    this.id = milestone.id;
    this.name = milestone.name;
    this.dueAt = milestone.dueAt.toISOString();
    this.submissionType = milestone.submissionType;
    this.instructions = milestone.instructions;
  }

  static from(milestone: ProgramMilestoneView): ProgramMilestoneResponseDto {
    return new ProgramMilestoneResponseDto(milestone);
  }
}

export class EditableProgramResponseDto {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: EditableProgramView['category'];
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly applicationCount: number;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly repositoryProvisioningEnabled: boolean;
  readonly description: string;
  readonly milestones: readonly ProgramMilestoneResponseDto[];
  readonly teamMinSize: number | null;
  readonly teamMaxSize: number | null;

  private constructor(program: EditableProgramView) {
    this.id = program.id;
    this.name = program.name;
    this.organizer = program.organizer;
    this.category = program.category;
    this.applicationTemplateKey = program.applicationTemplateKey;
    this.applicationTemplateVersion = program.applicationTemplateVersion;
    this.applicationCount = program.applicationCount;
    this.applicationStartAt = program.applicationStartAt.toISOString();
    this.applicationEndAt = program.applicationEndAt.toISOString();
    this.repositoryProvisioningEnabled = program.repositoryProvisioningEnabled;
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
