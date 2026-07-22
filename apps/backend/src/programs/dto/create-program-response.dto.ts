import type { Program } from '@prisma/client';

export class CreateProgramResponseDto {
  readonly id: string;
  readonly category: Program['category'];
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly detailUrl: string;

  private constructor(program: Program) {
    this.id = program.id;
    this.category = program.category;
    this.applicationTemplateKey = program.applicationTemplateKey;
    this.applicationTemplateVersion = program.applicationTemplateVersion;
    this.detailUrl = `/programs/${program.id}`;
  }

  static from(program: Program): CreateProgramResponseDto {
    return new CreateProgramResponseDto(program);
  }
}
