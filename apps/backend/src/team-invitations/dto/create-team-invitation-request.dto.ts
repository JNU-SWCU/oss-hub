import { IsNotEmpty, IsString } from 'class-validator';

export class CreateTeamInvitationRequestDto {
  @IsString()
  @IsNotEmpty()
  declare readonly inviteeUserId: string;
}
