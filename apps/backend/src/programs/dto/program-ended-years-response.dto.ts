export class ProgramEndedYearsResponseDto {
  declare readonly years: readonly number[];

  static from(years: readonly number[]): ProgramEndedYearsResponseDto {
    return { years };
  }
}
