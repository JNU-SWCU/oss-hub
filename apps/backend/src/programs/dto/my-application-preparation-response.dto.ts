import type { PreparationView } from '../application-preparation.error';
import { ApplicationPreparationResponseDto } from './application-preparation-response.dto';

export class MyApplicationPreparationResponseDto {
  declare readonly membership: 'NONE' | 'MEMBER' | 'LEADER';
  declare readonly preparation?: ApplicationPreparationResponseDto;

  static from(
    view: PreparationView | null,
  ): MyApplicationPreparationResponseDto {
    if (view === null) {
      return { membership: 'NONE' };
    }
    const preparation = ApplicationPreparationResponseDto.from(view);
    return {
      membership: preparation.isLeader ? 'LEADER' : 'MEMBER',
      preparation,
    };
  }
}
