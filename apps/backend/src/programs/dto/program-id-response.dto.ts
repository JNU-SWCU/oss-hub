export class ProgramIdResponseDto {
  declare readonly id: string;

  static from(program: { readonly id: string }): ProgramIdResponseDto {
    return { id: program.id };
  }
}
