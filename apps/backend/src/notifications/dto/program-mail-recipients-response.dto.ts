import { ApiProperty } from '@nestjs/swagger';

class ProgramMailApplicantResponseDto {
  declare readonly id: string;
  declare readonly displayName: string;
  declare readonly nickname: string;
  declare readonly mailAvailable: boolean;

  static from(
    value: ProgramMailApplicantResponseDto,
  ): ProgramMailApplicantResponseDto {
    return {
      id: value.id,
      displayName: value.displayName,
      nickname: value.nickname,
      mailAvailable: value.mailAvailable,
    };
  }
}

class ProgramMailTeamResponseDto {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  declare readonly deadlineEligible: boolean;
  @ApiProperty({ type: () => ProgramMailApplicantResponseDto, isArray: true })
  declare readonly applicants: readonly ProgramMailApplicantResponseDto[];

  static from(value: ProgramMailTeamResponseDto): ProgramMailTeamResponseDto {
    return {
      id: value.id,
      name: value.name,
      status: value.status,
      deadlineEligible: value.deadlineEligible,
      applicants: value.applicants.map((applicant) =>
        ProgramMailApplicantResponseDto.from(applicant),
      ),
    };
  }
}

export class ProgramMailRecipientsResponseDto {
  declare readonly programId: string;
  declare readonly programName: string;
  @ApiProperty({ type: () => ProgramMailTeamResponseDto, isArray: true })
  declare readonly teams: readonly ProgramMailTeamResponseDto[];

  static from(
    value: ProgramMailRecipientsResponseDto,
  ): ProgramMailRecipientsResponseDto {
    return {
      programId: value.programId,
      programName: value.programName,
      teams: value.teams.map((team) => ProgramMailTeamResponseDto.from(team)),
    };
  }
}
