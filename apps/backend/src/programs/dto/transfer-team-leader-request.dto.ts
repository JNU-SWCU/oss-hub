import { IsString, MaxLength, MinLength } from 'class-validator';

export class TransferTeamLeaderRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  readonly userId!: string;
}
