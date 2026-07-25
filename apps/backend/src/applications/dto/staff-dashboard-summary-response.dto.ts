import type { ProgramCategory } from '@prisma/client';
import type {
  StaffDashboardApplicationCounts,
  StaffDashboardProgramSummary,
  StaffDashboardSummary,
} from '../applications.repository';

export class StaffDashboardApplicationCountsResponseDto {
  readonly total: number;
  readonly submitted: number;
  readonly approved: number;
  readonly rejected: number;

  private constructor(counts: StaffDashboardApplicationCounts) {
    this.total = counts.total;
    this.submitted = counts.submitted;
    this.approved = counts.approved;
    this.rejected = counts.rejected;
  }

  static from(
    counts: StaffDashboardApplicationCounts,
  ): StaffDashboardApplicationCountsResponseDto {
    return new StaffDashboardApplicationCountsResponseDto(counts);
  }
}

export class StaffDashboardProgramSummaryResponseDto {
  readonly id: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };
  readonly applications: StaffDashboardApplicationCountsResponseDto;
  readonly applicantsPath: string;

  private constructor(program: StaffDashboardProgramSummary) {
    this.id = program.id;
    this.name = program.name;
    this.category = program.category;
    this.applicationPeriod = {
      startsAt: program.applicationPeriod.startsAt.toISOString(),
      endsAt: program.applicationPeriod.endsAt.toISOString(),
    };
    this.applications = StaffDashboardApplicationCountsResponseDto.from(
      program.applications,
    );
    this.applicantsPath = program.applicantsPath;
  }

  static from(
    program: StaffDashboardProgramSummary,
  ): StaffDashboardProgramSummaryResponseDto {
    return new StaffDashboardProgramSummaryResponseDto(program);
  }
}

export class StaffDashboardSummaryResponseDto {
  readonly programs: readonly StaffDashboardProgramSummaryResponseDto[];

  private constructor(summary: StaffDashboardSummary) {
    this.programs = summary.programs.map((program) =>
      StaffDashboardProgramSummaryResponseDto.from(program),
    );
  }

  static from(summary: StaffDashboardSummary): StaffDashboardSummaryResponseDto {
    return new StaffDashboardSummaryResponseDto(summary);
  }
}
