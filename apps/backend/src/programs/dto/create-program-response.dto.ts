import { CreatedProgram } from '../programs.types';
import type { ProgramCategory } from '@prisma/client';

export class CreateProgramResponseDto {
  declare readonly id: string;
  declare readonly category: ProgramCategory;
  declare readonly applicationTemplateKey: string;
  declare readonly applicationTemplateVersion: number;
  declare readonly endAt: string;
  declare readonly detailUrl: string;

  static from(program: CreatedProgram): CreateProgramResponseDto {
    return {
      id: program.id,
      category: program.category,
      applicationTemplateKey: program.applicationTemplateKey,
      applicationTemplateVersion: program.applicationTemplateVersion,
      endAt: program.endAt.toISOString(),
      detailUrl: `/programs/${program.id}`,
    };
  }
}
