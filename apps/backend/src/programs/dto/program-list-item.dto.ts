import { ProgramCategory } from '@prisma/client';

interface ProgramListRecord {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly description: string;
}

export class ProgramListItemDto {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly description: string;

  private constructor(program: ProgramListRecord) {
    this.id = program.id;
    this.name = program.name;
    this.organizer = program.organizer;
    this.category = program.category;
    this.applicationStartAt = program.applicationStartAt.toISOString();
    this.applicationEndAt = program.applicationEndAt.toISOString();
    this.description = program.description;
  }

  static from(program: ProgramListRecord): ProgramListItemDto {
    return new ProgramListItemDto(program);
  }
}
