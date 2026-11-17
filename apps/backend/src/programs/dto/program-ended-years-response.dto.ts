export class ProgramEndedYearsResponseDto {
  declare readonly years: number[];

  static from(years: readonly number[]): ProgramEndedYearsResponseDto {
    return { years: [...years] };
  }
}
