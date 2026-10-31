import { type ApplicationStatus } from '@prisma/client';
import type {
  PersonalizedProgramListItem,
  ProgramListItemNote,
  ProgramListPage,
  ProgramListPageItem,
} from '../programs.service';

export class ProgramListResponseDto {
  declare readonly coverImageUrl: string | null;
  declare readonly id: string;
  declare readonly name: string;
  declare readonly organizer: string;
  declare readonly trackType: PersonalizedProgramListItem['trackType'];

  declare readonly lifecycle: PersonalizedProgramListItem['lifecycle'];
  declare readonly applicationStartAt: string;
  declare readonly applicationEndAt: string;
  declare readonly endAt: string;
  declare readonly description: string;

  declare readonly note?: ProgramListItemNote;

  declare readonly viewerApplicationStatus?: ApplicationStatus;

  declare readonly applicationCount?: number;

  declare readonly pendingApplicationCount?: number;

  static from(program: ProgramListPageItem): ProgramListResponseDto {
    return {
      coverImageUrl: program.coverImageUrl,
      id: program.id,
      name: program.name,
      organizer: program.organizer,
      trackType: program.trackType,
      lifecycle: program.lifecycle,
      applicationStartAt: program.applicationStartAt.toISOString(),
      applicationEndAt: program.applicationEndAt.toISOString(),
      endAt: program.endAt.toISOString(),
      description: program.description,
      note: program.note,
      viewerApplicationStatus: program.viewerApplicationStatus,
      applicationCount: program.applicationCount,
      pendingApplicationCount: program.pendingApplicationCount,
    };
  }
}

export class ProgramListPageResponseDto {
  declare readonly items: readonly ProgramListResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly totalItems: number;
  declare readonly totalPages: number;

  static from(programPage: ProgramListPage): ProgramListPageResponseDto {
    return {
      items: programPage.items.map((program) =>
        ProgramListResponseDto.from(program),
      ),
      page: programPage.page,
      pageSize: programPage.pageSize,
      totalItems: programPage.totalItems,
      totalPages: programPage.totalPages,
    };
  }
}
