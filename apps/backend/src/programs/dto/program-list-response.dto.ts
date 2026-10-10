import { type ApplicationStatus } from '@prisma/client';
import { programCoverImageUrl } from '../program-cover';
import type {
  PersonalizedProgramListItem,
  ProgramListItemNote,
  ProgramListPage,
} from '../domain/program-list';

export class ProgramListResponseDto {
  readonly coverImageUrl: string | null;
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly trackType: PersonalizedProgramListItem['trackType'];

  readonly lifecycle: PersonalizedProgramListItem['lifecycle'];
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly endAt: string;
  readonly description: string;

  readonly note?: ProgramListItemNote;

  readonly viewerApplicationStatus?: ApplicationStatus;

  readonly applicationCount?: number;

  readonly pendingApplicationCount?: number;

  private constructor(program: PersonalizedProgramListItem) {
    this.coverImageUrl = programCoverImageUrl(
      program.id,
      program.coverId,
      program.coverExternalImageUrl,
    );
    this.id = program.id;
    this.name = program.name;
    this.organizer = program.organizer;
    this.trackType = program.trackType;
    this.lifecycle = program.lifecycle;
    this.applicationStartAt = program.applicationStartAt.toISOString();
    this.applicationEndAt = program.applicationEndAt.toISOString();
    this.endAt = program.endAt.toISOString();
    this.description = program.description;
    this.note = program.note;
    this.viewerApplicationStatus = program.viewerApplicationStatus;
    this.applicationCount = program.applicationCount;
    this.pendingApplicationCount = program.pendingApplicationCount;
  }

  static from(program: PersonalizedProgramListItem): ProgramListResponseDto {
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
