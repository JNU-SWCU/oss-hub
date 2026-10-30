export class DeletedResponseDto {
  declare readonly deleted: true;

  static from(): DeletedResponseDto {
    return { deleted: true };
  }
}
