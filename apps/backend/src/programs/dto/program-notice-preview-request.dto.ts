import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ProgramNoticePreviewRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  declare readonly url: string;
}
