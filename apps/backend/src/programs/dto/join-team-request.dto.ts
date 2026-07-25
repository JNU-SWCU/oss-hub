import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class JoinTeamRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  declare readonly joinCode: string;
}
