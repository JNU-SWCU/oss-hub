import { type ApplicationStatus } from '@prisma/client';
import type {
  PersonalizedProgramListItem,
  ProgramListPage,
  ProgramListPageItem,
} from '../programs.service';

export class ProgramListResponseDto {
  declare readonly coverImageUrl: string | null;
  declare readonly id: string;
  declare readonly name: string;
  declare readonly organizers: string[];
  declare readonly trackType: PersonalizedProgramListItem['trackType'];
  declare readonly applicationStartAt: string;
  declare readonly applicationEndAt: string;
  declare readonly endAt: string;

  declare readonly note?: {
    readonly text: string;
    readonly icon?: 'team';
  };

  declare readonly viewerApplicationStatus?: ApplicationStatus;

  static from(program: ProgramListPageItem): ProgramListResponseDto {
    return {
      coverImageUrl: program.coverImageUrl,
      id: program.id,
      name: program.name,
      organizers: [...program.organizers],
      trackType: program.trackType,
      applicationStartAt: program.applicationStartAt.toISOString(),
      applicationEndAt: program.applicationEndAt.toISOString(),
      endAt: program.endAt.toISOString(),
      note: program.note,
      viewerApplicationStatus: program.viewerApplicationStatus,
    };
  }
}

export class ProgramListPageResponseDto {
  declare readonly items: ProgramListResponseDto[];
  declare readonly totalPages: number;

  static from(programPage: ProgramListPage): ProgramListPageResponseDto {
    return {
      items: programPage.items.map((program) =>
        ProgramListResponseDto.from(program),
      ),
      totalPages: programPage.totalPages,
    };
  }
}
