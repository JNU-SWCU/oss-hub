import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateBoardPostRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare readonly title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  declare readonly body: string;
}
