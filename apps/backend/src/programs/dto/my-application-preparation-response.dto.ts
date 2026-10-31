import type { ApplicationPreparationResponseDto } from './application-preparation-response.dto';

export class MyApplicationPreparationResponseDto {
  declare readonly membership: 'NONE' | 'MEMBER' | 'LEADER';
  declare readonly preparation?: ApplicationPreparationResponseDto;

  static from(
    preparation: ApplicationPreparationResponseDto | null,
  ): MyApplicationPreparationResponseDto {
    if (preparation === null) {
      return { membership: 'NONE' };
    }
    return {
      membership: preparation.isLeader ? 'LEADER' : 'MEMBER',
      preparation,
    };
  }
}
