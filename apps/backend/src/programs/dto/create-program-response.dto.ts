import { CreatedProgram } from '../domain/program-creation';
import type { ProgramCategory } from '@prisma/client';

export class CreateProgramResponseDto {
  readonly id: string;
  readonly category: ProgramCategory;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly endAt: string;
  readonly detailUrl: string;

  private constructor(program: CreatedProgram) {
    this.id = program.id;
    this.category = program.category;
    this.applicationTemplateKey = program.applicationTemplateKey;
    this.applicationTemplateVersion = program.applicationTemplateVersion;
    this.endAt = program.endAt.toISOString();
    this.detailUrl = `/programs/${program.id}`;
  }

  static from(program: CreatedProgram): CreateProgramResponseDto {
    return new CreateProgramResponseDto(program);
  }
}
