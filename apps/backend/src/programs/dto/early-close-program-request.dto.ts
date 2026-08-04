import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class EarlyCloseProgramRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  declare reason: string;
}