import { type ApplicationStatus } from '@prisma/client';
import type {
  PersonalizedProgramListItem,
  ProgramListItemNote,
  ProgramListPage,
} from '../programs.service';

export class ProgramListResponseDto {
  readonly id: string;
  readonly name: string;
  readonly organizer: string;
  readonly category: PersonalizedProgramListItem['category'];
  /** 게시 축(PUBLISHED|ARCHIVED). 모집 기간 파생 상태가 아니다. */
  readonly lifecycle: PersonalizedProgramListItem['lifecycle'];
  readonly applicationStartAt: string;
  readonly applicationEndAt: string;
  readonly endAt: string | null;
  readonly description: string;
  /** 카드 하단 안내. 인증되지 않은 요청·개인화 대상이 아닌 뷰어는 항상 생략된다. */
  readonly note?: ProgramListItemNote;
  /** 뷰어(학생) 본인의 신청 상태. 신청한 적 없으면 생략. */
  readonly viewerApplicationStatus?: ApplicationStatus;
  /** 뷰어(STAFF/ADMIN)용 — 전체 지원 건수 집계. 공개·학생 응답에는 절대 담기지 않는다. */
  readonly applicationCount?: number;
  /** 뷰어(STAFF/ADMIN)용 — 승인 대기 건수 집계. 공개·학생 응답에는 절대 담기지 않는다. */
  readonly pendingApplicationCount?: number;

  private constructor(program: PersonalizedProgramListItem) {
    this.id = program.id;
    this.name = program.name;
    this.organizer = program.organizer;
    this.category = program.category;
    this.lifecycle = program.lifecycle;
    this.applicationStartAt = program.applicationStartAt.toISOString();
    this.applicationEndAt = program.applicationEndAt.toISOString();
    this.endAt = program.endAt ? program.endAt.toISOString() : null;
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
