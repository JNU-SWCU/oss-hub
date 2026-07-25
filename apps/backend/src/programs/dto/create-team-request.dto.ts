import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTeamRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare readonly name: string;
}
