export class BoardPostPinResponseDto {
  declare readonly pinned: boolean;

  static from(pinned: boolean): BoardPostPinResponseDto {
    return { pinned };
  }
}
