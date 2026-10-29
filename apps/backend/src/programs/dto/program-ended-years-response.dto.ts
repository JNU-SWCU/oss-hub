export class ProgramEndedYearsResponseDto {
  readonly years: readonly number[];

  private constructor(years: readonly number[]) {
    this.years = years;
  }

  static from(years: readonly number[]): ProgramEndedYearsResponseDto {
    return new ProgramEndedYearsResponseDto(years);
  }
}
