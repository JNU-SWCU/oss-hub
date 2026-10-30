import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateBoardCommentRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  declare readonly body: string;
}
