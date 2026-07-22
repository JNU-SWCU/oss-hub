import { ProgramCategory, type Program } from '@prisma/client';
import type { ProgramListPage } from '../programs.service';

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

export class ProgramListPageResponseDto {
  readonly items: readonly ProgramListResponseDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;

  private constructor(programPage: ProgramListPage) {
    this.items = programPage.items.map((program) =>
      ProgramListResponseDto.from(program),
    );
    this.page = programPage.page;
    this.pageSize = programPage.pageSize;
    this.totalItems = programPage.totalItems;
    this.totalPages = programPage.totalPages;
  }

  static from(programPage: ProgramListPage): ProgramListPageResponseDto {
    return new ProgramListPageResponseDto(programPage);
  }
}
