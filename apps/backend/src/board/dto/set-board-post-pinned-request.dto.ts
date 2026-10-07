import { IsBoolean } from 'class-validator';

export class SetBoardPostPinnedRequestDto {
  @IsBoolean()
  declare readonly pinned: boolean;
}
