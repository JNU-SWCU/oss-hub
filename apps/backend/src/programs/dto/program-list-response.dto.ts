import { ProgramCategory, type Program } from '@prisma/client';

export class ProgramListResponseDto {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly description: string;

  private constructor(
    program: Pick<
      Program,
      | 'id'
      | 'name'
      | 'organizer'
      | 'category'
      | 'applicationStartAt'
      | 'applicationEndAt'
      | 'description'
    >,
  ) {
    this.id = program.id;
    this.name = program.name;
    this.organizer = program.organizer;
    this.category = program.category;
    this.applicationStartAt = program.applicationStartAt.toISOString();
    this.applicationEndAt = program.applicationEndAt.toISOString();
    this.description = program.description;
  }

  static from(
    program: Pick<
      Program,
      | 'id'
      | 'name'
      | 'organizer'
      | 'category'
      | 'applicationStartAt'
      | 'applicationEndAt'
      | 'description'
    >,
  ): ProgramListResponseDto {
    return new ProgramListResponseDto(program);
  }
}
