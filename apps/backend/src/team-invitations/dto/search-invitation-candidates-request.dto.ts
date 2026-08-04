import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SearchInvitationCandidatesRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare readonly query: string;
}
