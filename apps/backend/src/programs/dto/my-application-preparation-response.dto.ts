export class MyApplicationPreparationResponseDto {
  declare readonly membership: 'NONE';

  static from(): MyApplicationPreparationResponseDto {
    return { membership: 'NONE' };
  }
}
