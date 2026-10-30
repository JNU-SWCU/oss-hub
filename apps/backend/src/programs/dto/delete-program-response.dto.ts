export class DeleteProgramResponseDto {
  declare readonly id: string;
  declare readonly deleted: true;

  static from(result: {
    readonly id: string;
    readonly deleted: true;
  }): DeleteProgramResponseDto {
    return { ...result };
  }
}
